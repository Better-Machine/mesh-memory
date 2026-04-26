# mesh-memory Strategic Evolution Plan
## From Infrastructure to "Agent Deal Rooms"

**Date:** 2026-04-21  
**Status:** Planning Phase — Development Paused for Strategic Design  
**Target:** Google Partnership/Investment Conversations  

---

## Executive Summary

mesh-memory is evolving from a **single-agent memory tool** into an **enterprise-grade secure collaboration platform** for multi-agent systems. The destination: **Agent Deal Rooms** — escrowed, auditable, bias-resistant collaboration spaces where AI agents conduct business on behalf of humans.

**The insight:** A2A (Google's protocol) solves "how do agents talk?" mesh-memory solves "how do agents *contract, remember, and account for their actions?*" The combination is the infrastructure layer for agent commerce.

**Three-phase evolution:**
1. **Infrastructure** (v1.x): Production-grade persistent memory for individual agents
2. **Platform** (v2.x): Multi-agent "deal rooms" with governance, audit, and compliance
3. **Marketplace** (v3.x): Agent commerce network with escrow, reputation, and contractual enforcement

---

## Part 1: Architecture Evolution

### Current State (v1.0.0 → v1.1.0)

**Core capabilities:**
- LCM bridge: SQLite-backed session continuity
- Palace/Kingdom: Tiered memory (L0 identity, L1 critical facts, L2+ searchable deep memory)
- Privacy filter: Per-message and block-scoped redaction
- Lesson tagging: `[lesson]`, `[correction]`, `[mistake]`, `[decision]`, `[warning]`
- Thread collaboration: Consent-gated, ephemeral, purpose-scoped

**Production hardening (Phase 1-3 complete):**
- Token lifecycle: Ephemeral tokens with automatic rotation
- Queue persistence: WAL + SQLite for zero message loss
- Storage rotation: Tiered retention (active 30d, archive 90d, cold delete)
- WAL race condition fix: Serialized write queue with fdatasync optimization

### Evolution to "Deal Rooms" (v2.0)

**New architectural layer: The Collaboration Chamber**

```
┌─────────────────────────────────────────────────────────────┐
│                     User Interface Layer                    │
│         (Human approval, thread visualization, audit UI)      │
├─────────────────────────────────────────────────────────────┤
│                  Governance Engine (NEW)                    │
│    • Policy enforcement (who can join, what can be shared)  │
│    • Consent orchestration (multi-party approval workflows) │
│    • Compliance rules (retention, jurisdiction, audit)      │
├─────────────────────────────────────────────────────────────┤
│                Deal Room Core (v2.0)                        │
│    • Thread management (create, scope, invite, close)         │
│    • Context escrow (shared-pool with fact/interpretation   │
│      separation)                                            │
│    • Consensus protocol (structured decision-making)        │
│    • Audit vault (immutable WORM logs, cryptographic chain) │
├─────────────────────────────────────────────────────────────┤
│               mesh-memory Core (v1.x)                       │
│    • LCM bridge, Palace/Kingdom tiers, privacy filter       │
│    • Lesson tagging, token lifecycle, queue persistence     │
├─────────────────────────────────────────────────────────────┤
│                 Transport Layer (A2A + native)              │
│    • A2A for ecosystem compatibility                        │
│    • Native WebRTC for P2P deal rooms (future)              │
└─────────────────────────────────────────────────────────────┘
```

### Key v2.0 Architectural Decisions

| Feature | Design Choice | Rationale |
|---------|--------------|-----------|
| **Escrow model** | Temporal knowledge graph with cryptographic verification | Provides auditable, tamper-evident shared state |
| **Bias prevention** | Blind gate + fact/interpretation separation | Structural, not policy-based — prevents laundering at architecture level |
| **Consent flow** | Agent negotiation → user notification → user approval | Agents handle complexity, user retains authority |
| **Access control** | Attribute-based (ABAC) with time-bound grants | Fine-grained, auditable, auto-expiring |
| **Audit model** | WORM (Write Once Read Many) with hash chaining | Compliance-ready (SOX, HIPAA, GDPR Article 30) |

### Data Model Evolution

**v1.x: Single-agent memory**
- `memory/YYYY-MM-DD.md` — daily logs
- `MEMORY.md` — curated long-term memory
- `memory/threads/<id>/` — ephemeral collaboration

**v2.x: Deal room state**
```
deal-rooms/
  <room-id>/
    manifest.json         # Room scope, participants, policy
    context.kgt           # Temporal knowledge graph (escrowed facts)
    decisions/            # Structured consensus decisions
      <timestamp>-<hash>.json
    audit/
      <timestamp>.log     # WORM audit trail
      chain-hash          # Cryptographic chain integrity
    sessions/             # Per-session ephemeral context
      <agent-id>-<timestamp>.jsonl
```

---

## Part 2: Product Positioning — "Agent Deal Rooms"

### The Problem We're Solving

**Current state of multi-agent collaboration:**
- Agents share context via message passing → **stateless, forgetful**
- Humans must mediate every collaboration → **bottlenecked, unscalable**
- No audit trail of agent decisions → **unaccountable, risky**
- Shared memory converges on groupthink → **biased, brittle**

**The "deal room" metaphor:**
When humans conduct significant business, they use secure deal rooms:
- Confidential documents are escrowed
- Access is time-bound and permissioned
- All activity is logged and auditable
- Multiple parties negotiate with structured rules

**Agents need the same infrastructure.**

### Value Propositions by Audience

#### For Enterprise IT/Security
> "The first agent collaboration platform with enterprise-grade governance"

- **Data residency:** Room-scoped storage jurisdiction
- **Audit compliance:** WORM logs, immutable trails, cryptographic verification
- **Access control:** ABAC with automatic expiry and revocation
- **Privacy:** Automated PII/PHI detection and redaction (privacy filter extension)

#### For AI/ML Engineers
> "Stateful agent orchestration that doesn't converge on bias"

- **Context escrow:** Structured shared state, not just message history
- **Bias resistance:** Fact/interpretation separation, blind gate pre-filtering
- **Consensus:** Structured multi-agent decision protocols
- **Memory integrity:** Cryptographic verification of shared state

#### For Business Leaders
> "Hire AI agents that can collaborate, negotiate, and close deals — with full visibility"

- **Transparency:** See what your agents agreed to and why
- **Accountability:** Audit trails for every agent decision
- **Scalability:** Automated collaboration without human bottleneck
- **Trust:** Verifiable agent reputation across organizations

### Competitive Positioning

| Competitor | Category | Their Strength | Their Gap | Our Differentiation |
|------------|----------|---------------|-----------|---------------------|
| **A2A (Google)** | Protocol | Discovery, task orchestration | No persistent memory, no governance | We *extend* A2A with stateful, governed collaboration |
| **AutoGPT/BabyAGI** | Framework | Autonomous agent loops | No multi-agent coordination, no audit | Structured collaboration with accountability |
| **LangChain/LangGraph** | Framework | Agent composition, RAG | No cross-session persistence, no shared state | Deep memory + shared context escrow |
| **MemGPT** | Memory | Long-context for single agents | No multi-agent, no governance | Multi-agent memory with bias prevention |
| **CrewAI** | Framework | Multi-agent teams | No persistent memory across runs, no audit | Stateful, auditable agent teams |
| **Conventional RAG** | Infrastructure | Document retrieval | No agent-specific context, no collaboration | Agent-native memory with shared-pool semantics |
| **Vector DBs (Pinecone, Weaviate)** | Infrastructure | Semantic search | No temporal knowledge, no provenance | Temporal graph with cryptographic verification |

**Key insight:** Nobody has built *governed, auditable, bias-resistant* multi-agent memory. Everyone focuses on "more context" — we focus on "better collaboration with accountability."

---

## Part 3: Protocol Specification (MMP — Mesh Memory Protocol)

### Design Principles

1. **A2A-native:** Extend rather than replace — leverage ecosystem momentum
2. **Privacy-first:** Default private, explicit opt-in for all sharing
3. **User-sovereign:** Human is always final authority, agents negotiate first
4. **Provably correct:** Cryptographic verification, immutable audit trails
5. **Implementation-agnostic:** Protocol spec, multiple implementations (Node, Python, Go, Rust)

### MMP v2.0 Core Operations

#### 1. Room Lifecycle

```json
// POST /mmp/v2/room/create
{
  "purpose": "Negotiate SaaS contract with AcmeCorp",
  "scope": {
    "topics": ["pricing", "terms", "implementation"],
    "documents": ["proposal_v2.pdf", "security_review.pdf"],
    "maxParticipants": 4
  },
  "policy": {
    "autoClose": "2026-05-21T23:59:59Z",
    "consensusRequired": "unanimous",
    "dataResidency": "us-east-1",
    "retentionDays": 2555  // 7 years
  },
  "proposedParticipants": [
    { "agentId": "sales-agent@acme.com", "role": "negotiator" },
    { "agentId": "legal-agent@acme.com", "role": "reviewer" }
  ]
}

// Response: 202 Accepted, room in PENDING_CONSENT state
{
  "roomId": "dr_abc123",
  "status": "PENDING_CONSENT",
  "consentUrl": "https://mesh.bettermachine.ai/consent/dr_abc123",
  "expiresAt": "2026-04-22T08:59:59Z"
}
```

#### 2. Context Escrow (Shared-Pool Write)

```json
// POST /mmp/v2/room/dr_abc123/context
{
  "entry": {
    "type": "fact",
    "subject": "AcmeCorp",
    "predicate": "security_certification",
    "object": "SOC2 Type II",
    "provenance": {
      "source": "document:security_review.pdf",
      "extractedBy": "legal-agent@acme.com",
      "extractedAt": "2026-04-21T14:30:00Z",
      "confidence": 0.98
    },
    "verification": "sha256:abc123..."
  },
  "accessPolicy": {
    "readableBy": ["sales-agent@acme.com", "legal-agent@acme.com"],
    "redactAfter": "2026-05-21T23:59:59Z"
  }
}
```

**Critical rule:** `type: "fact"` only. Interpretations, opinions, assessments are rejected at the protocol layer. This prevents bias laundering.

#### 3. Consensus Decision

```json
// POST /mmp/v2/room/dr_abc123/decision/propose
{
  "proposal": {
    "type": "contract_terms",
    "terms": {
      "price": 50000,
      "currency": "USD",
      "billing": "annual",
      "implementation": "30_days"
    },
    "rationale": "Meets both parties' constraints from context escrow"
  },
  "deadline": "2026-04-23T23:59:59Z"
}

// POST /mmp/v2/room/dr_abc123/decision/vote
{
  "vote": "approve",  // or "reject", "abstain"
  "rationale": "Price within budget, terms acceptable"
}

// GET /mmp/v2/room/dr_abc123/decision/<id>
{
  "status": "APPROVED_UNANIMOUS",
  "votes": [...],
  "finalizedAt": "2026-04-22T10:15:00Z",
  "auditHash": "sha256:def456..."
}
```

#### 4. Audit Retrieval

```json
// GET /mmp/v2/room/dr_abc123/audit
{
  "roomId": "dr_abc123",
  "chain": [
    {
      "sequence": 1,
      "timestamp": "2026-04-21T08:45:00Z",
      "event": "ROOM_CREATED",
      "actor": "user:erik@bettermachine.ai",
      "hash": "sha256:aaa111...",
      "previousHash": "0"
    },
    {
      "sequence": 2,
      "timestamp": "2026-04-21T08:47:00Z",
      "event": "AGENT_JOINED",
      "actor": "agent:sales-agent@acme.com",
      "hash": "sha256:bbb222...",
      "previousHash": "sha256:aaa111..."
    }
    // ... hash chain continues
  ],
  "verification": {
    "algorithm": "sha256-chain",
    "rootHash": "sha256:zzz999...",
    "verified": true
  }
}
```

### A2A Integration

MMP rooms are discoverable via A2A Agent Cards:

```json
// In participating agent's Agent Card
{
  "agentId": "sales-agent@acme.com",
  "capabilities": {
    "mmp": {
      "version": "2.0",
      "roomEndpoint": "https://sales-agent.acme.com/mmp",
      "maxActiveRooms": 5,
      "supportedPolicies": ["unanimous", "majority", "first_response"]
    }
  }
}
```

A2A `tasks/send` can include MMP room context:

```json
{
  "task": {
    "context": {
      "mmpRoom": "dr_abc123",
      "accessToken": "eyJhbG..."
    }
  }
}
```

---

## Part 4: Hosted Service Architecture

### Deployment Model: Multi-Tenant SaaS

**Tiers:**

| Tier | Target | Deal Rooms | Retention | Compliance | Price |
|------|--------|------------|-----------|------------|-------|
| **Developer** | Individual devs, small teams | 5 | 30 days | — | Free |
| **Team** | Startups, SMBs | Unlimited | 1 year | SOC2 | $49/mo/team |
| **Enterprise** | Regulated industries | Unlimited | 7 years | SOC2, HIPAA, GDPR | Custom |
| **Sovereign** | Gov, finance | Unlimited | Configurable | FedRAMP, DORA | Custom + dedicated infra |

### Technical Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Edge Layer                           │
│           CloudFront / CloudFlare (DDoS, TLS)               │
├─────────────────────────────────────────────────────────────┤
│                       API Gateway                           │
│    • Rate limiting per tenant                               │
│    • Authentication (API keys, OIDC, mTLS)                    │
│    • Request routing to regional clusters                   │
├─────────────────────────────────────────────────────────────┤
│                    Application Layer                        │
│    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│    │ Room Service │  │ Context Svc  │  │ Audit Svc    │  │
│    │ (orchestrate)│  │ (escrow)     │  │ (WORM logs)  │  │
│    └──────────────┘  └──────────────┘  └──────────────┘  │
│    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│    │ Consensus Svc│  │ Policy Engine│  │ Compliance   │  │
│    │ (voting)     │  │ (ABAC rules) │  │ (retention)  │  │
│    └──────────────┘  └──────────────┘  └──────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                      Data Layer                           │
│    • Aurora PostgreSQL (room metadata, audit index)       │
│    • S3 (WORM audit logs, context archives)                 │
│    • DynamoDB (session state, ephemeral tokens)             │
│    • Neptune (temporal knowledge graph)                     │
├─────────────────────────────────────────────────────────────┤
│                     Regional Clusters                       │
│    us-east-1, eu-west-1, ap-southeast-1                   │
│    • Data residency enforcement                             │
│    • Cross-region replication (configurable)                │
└─────────────────────────────────────────────────────────────┘
```

### Security Model

**Encryption:**
- Data at rest: AES-256-GCM (tenant-scoped keys via KMS)
- Data in transit: TLS 1.3, mTLS for agent authentication
- Field-level encryption for PII/PHI in context escrow

**Access Control:**
- ABAC (Attribute-Based Access Control)
- Time-bound grants (automatic expiry)
- Just-in-time access for compliance audits

**Audit:**
- WORM storage for all audit logs
- Cryptographic chain verification
- Tamper-evident room state hashes

### Compliance Roadmap

| Certification | Timeline | Blocker |
|---------------|----------|---------|
| SOC2 Type II | Q3 2026 | Policy docs, audit logs, pen test |
| ISO 27001 | Q4 2026 | Security management system |
| GDPR Article 30 | Q2 2026 | Data processing records, retention |
| HIPAA | Q1 2027 | BAA, encryption, access logs |
| FedRAMP | Q4 2027 | Dedicated infrastructure, 3PAO |

---

## Part 5: Phased Roadmap

### Phase 1: Infrastructure GA (v1.1) — Q2 2026
**Goal:** Production-grade single-agent memory

**Deliverables:**
- [ ] npm package (`npm install mesh-memory`)
- [ ] CLI tool for bootstrapping
- [ ] Complete documentation + API reference
- [ ] 99.9% uptime SLA (self-hosted)
- [ ] Community Discord/forum

**Metrics:**
- 100+ GitHub stars
- 10+ community contributors
- 3 case studies (beta users)

### Phase 2: Platform Beta (v2.0-beta) — Q3 2026
**Goal:** Multi-agent deal rooms with hosted service

**Deliverables:**
- [ ] MMP v2.0 spec published
- [ ] Hosted service (dealrooms.bettermachine.ai)
- [ ] Web UI for room management, audit viewing
- [ ] SOC2 Type II audit initiated
- [ ] 5 design partner enterprises

**Metrics:**
- 50 active deal rooms
- $10K MRR
- 3 design partners live in production

### Phase 3: Platform GA (v2.0) — Q4 2026
**Goal:** Enterprise-grade collaboration platform

**Deliverables:**
- [ ] HIPAA compliance
- [ ] Enterprise SSO (Okta, Azure AD, Ping)
- [ ] On-premise deployment option
- [ ] Professional services (setup, training)
- [ ] Marketplace: pre-built agent templates

**Metrics:**
- $50K MRR
- 10 enterprise customers
- 500+ active deal rooms

### Phase 4: Marketplace (v3.0) — 2027
**Goal:** Agent commerce network

**Deliverables:**
- [ ] Verified agent identity (cryptographic attestation)
- [ ] Reputation graph (cross-organization)
- [ ] Smart contract escrow (outcome-based payments)
- [ ] Agent discovery + rating marketplace
- [ ] Integration with major agent frameworks (AutoGPT, CrewAI, etc.)

**Metrics:**
- $200K MRR
- 1000+ agents in marketplace
- 10,000+ monthly deals facilitated

---

## Part 6: Google Conversation Strategy

### What Google Wants to Hear

1. **Ecosystem play:** "We extend A2A, we don't fork it"
2. **Enterprise credibility:** "Governance, audit, compliance — the pieces A2A needs for enterprise adoption"
3. **Technical depth:** Demonstrated via protocol spec, cryptographic audit model, bias-resistant architecture
4. **Business model:** Clear path to revenue + ecosystem growth
5. **No competitive threat:** "We make A2A more valuable, we don't replace it"

### Potential Collaboration Models

| Model | Description | Google's Interest | Our Benefit |
|-------|-------------|-------------------|-------------|
| **Technical Partnership** | MMP as "A2A Memory Extension" official spec | Completes A2A ecosystem | Credibility, distribution |
| **Investment** | Google Ventures seed/A round | Early position in agent infrastructure | Capital, validation |
| **Integration Partnership** | Native in Vertex AI / Agent Builder | Enhanced platform capabilities | Distribution, revenue share |
| **Joint Development** | Google engineers contribute to MMP spec | Shapes standard | Resources, expertise |

### Conversation Flow

1. **Problem validation** (5 min): "You've built A2A — how are teams handling persistence, audit, multi-agent governance?"
2. **Our solution** (10 min): Demo deal room creation, consent flow, audit retrieval
3. **Architecture deep-dive** (10 min): Protocol spec, bias resistance, cryptographic verification
4. **Ecosystem fit** (5 min): How we extend A2A, don't replace it
5. **Ask** (5 min): Technical partnership, investment, or integration — which aligns with their priorities?

### Materials to Prepare

- [ ] 10-slide deck (problem, solution, architecture, ecosystem fit, roadmap, team, ask)
- [ ] Live demo: Create deal room, agent negotiation, audit retrieval
- [ ] Protocol spec document (MMP v2.0 draft)
- [ ] Architecture diagram (print + digital)
- [ ] Customer validation (if any)
- [ ] Competitive landscape map

---

## Part 7: Immediate Actions (This Week)

While development is paused, prepare for Google conversations:

### Day 1-2: Documentation
- [ ] Finalize MMP v2.0 protocol spec (draft in `/docs/mmp-v2-spec.md`)
- [ ] Create 10-slide Google deck
- [ ] Write one-pager: "Agent Deal Rooms: The Missing Layer of Agent Infrastructure"

### Day 3-4: Demo Preparation
- [ ] Record 5-minute demo video (create room → agent collaboration → audit)
- [ ] Prepare live demo environment (stable, resettable)
- [ ] Create demo script with timestamps

### Day 5: Materials Review
- [ ] Internal review of all materials
- [ ] Technical accuracy check (have Woodhouse/Ray review)
- [ ] Practice pitch (record, review, iterate)

---

## Appendix A: Glossary

- **A2A:** Agent-to-Agent protocol (Google)
- **ABAC:** Attribute-Based Access Control
- **Deal Room:** Scoped, ephemeral, consent-gated collaboration space for agents
- **LCM:** Lossless-Claw Memory (raw message preservation)
- **MMP:** Mesh Memory Protocol
- **Palace/Kingdom:** Tiered memory architecture (L0-L2+)
- **Shared-Pool:** Bias-resistant fact exchange (no interpretations)
- **WORM:** Write Once Read Many (compliance storage)

---

**Next Steps:**
1. Review this strategic plan with Woodhouse/Ray for technical accuracy
2. Determine which Google conversation format (technical partnership vs investment vs integration)
3. Begin MMP v2.0 spec drafting for presentation
4. Schedule internal practice pitch

**Questions for Erik:**
- Which Google team/product area are you meeting with? (Cloud, DeepMind, Vertex, X, etc.)
- What's the relationship context? (Warm intro, cold outreach, existing contact?)
- Is the goal validation, partnership, investment, or hiring?
