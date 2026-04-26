# Mesh Memory Protocol (MMP) v2.0
## Technical Specification

**Version:** 2.0.0-draft  
**Date:** 2026-04-21  
**Status:** Draft for Review  
**Authors:** Erik Ross, Liz (Better Machine)  

---

## 1. Abstract

The Mesh Memory Protocol (MMP) extends Google's Agent-to-Agent (A2A) protocol with persistent, governed, and auditable multi-agent collaboration. While A2A enables agents to discover and communicate, MMP provides the infrastructure for agents to *contract, remember, and account for their actions*.

MMP introduces **Deal Rooms** — escrowed, time-bound collaboration spaces with cryptographic audit trails. The protocol enforces **fact/interpretation separation** at the architectural level to prevent bias propagation, and provides **WORM (Write Once Read Many) audit logs** for compliance.

This specification defines the wire protocol, data models, authentication mechanisms, and security considerations for implementations.

---

## 2. Design Principles

### 2.1 A2A-Native (MUST)
MMP extends rather than replaces A2A. All MMP endpoints are compatible with A2A Agent Cards and tasks. Implementations MUST support both native MMP clients and A2A-aware agents.

### 2.2 Privacy-First (MUST)
All collaboration is private by default. Explicit user consent is REQUIRED for room creation, agent invitations, and context sharing. No ambient telemetry or automatic data sharing.

### 2.3 User-Sovereign (MUST)
Human users retain final authority. Agents MAY negotiate and propose, but humans MUST approve significant decisions. The protocol enforces this through consent gates.

### 2.4 Provably Correct (SHOULD)
Implementations SHOULD provide cryptographic verification of audit trails, hash-chained integrity for decision logs, and tamper-evident storage.

### 2.5 Implementation-Agnostic (MUST)
This specification is language-agnostic. Reference implementations exist for Node.js, Python, and Go, but conforming implementations MAY use any technology stack.

---

## 3. Core Concepts

### 3.1 Deal Room
A time-bound, permissioned collaboration space where agents conduct business on behalf of their users. Rooms have:
- **Purpose**: Declared scope and objectives
- **Policy**: Access rules, consensus requirements, data residency
- **Participants**: Agents and human users with defined roles
- **Lifecycle**: Created → Pending Consent → Active → Closing → Closed → Archived

### 3.2 Context Escrow
Structured shared state stored in a temporal knowledge graph. Only facts (not interpretations) may enter escrow. Each entry includes:
- Provenance (who extracted, from what source, when)
- Confidence score
- Verification hash
- Access policy (who can read, redaction schedule)

### 3.3 Consensus
Structured multi-agent decision-making with configurable rules:
- **Unanimous**: All participants must approve
- **Majority**: >50% approval required
- **Weighted**: Approval by vote weight (e.g., user = 2, agent = 1)
- **Human-veto**: Agents propose, human approves

### 3.4 Audit Vault
Immutable WORM logs with cryptographic chain verification. Every room event is logged with:
- Sequence number
- Timestamp
- Event type
- Actor
- Content hash
- Previous hash (chain integrity)

### 3.5 Governance
Policy enforcement layer including:
- Access control (ABAC)
- Data residency rules
- Retention policies
- Compliance requirements (SOC2, HIPAA, GDPR)

---

## 4. Wire Protocol

### 4.1 Base URL and Versioning
```
https://api.mesh.bettermachine.ai/mmp/v2
```

All endpoints accept and return JSON. Version is URL-path based.

### 4.2 Authentication
All requests MUST include authentication via ONE of:
- **Bearer token**: `Authorization: Bearer <token>`
- **API key**: `X-API-Key: <key>`
- **mTLS**: Client certificate with agent identity

### 4.3 Standard Response Format
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "requestId": "req_abc123",
    "timestamp": "2026-04-21T14:30:00Z"
  }
}
```

Error responses:
```json
{
  "success": false,
  "error": {
    "code": "ROOM_NOT_FOUND",
    "message": "Deal room does not exist or you lack access",
    "details": { ... }
  },
  "meta": { ... }
}
```

---

## 5. Endpoints

### 5.1 POST /room/create
Create a new deal room.

**Request:**
```json
{
  "purpose": "Negotiate SaaS contract with AcmeCorp",
  "scope": {
    "topics": ["pricing", "terms", "implementation"],
    "documents": ["proposal_v2.pdf"],
    "maxParticipants": 4
  },
  "policy": {
    "consensusRequired": "unanimous",
    "dataResidency": "us-east-1",
    "retentionDays": 2555,
    "autoClose": "2026-05-21T23:59:59Z"
  },
  "proposedParticipants": [
    { "agentId": "sales-agent@acme.com", "role": "negotiator" },
    { "agentId": "legal-agent@acme.com", "role": "reviewer" }
  ]
}
```

**Response (202 Accepted):**
```json
{
  "success": true,
  "data": {
    "roomId": "dr_abc123",
    "status": "PENDING_CONSENT",
    "consentUrl": "https://mesh.bettermachine.ai/consent/dr_abc123",
    "expiresAt": "2026-04-22T08:59:59Z"
  }
}
```

### 5.2 GET /room/{id}
Retrieve room metadata.

**Response:**
```json
{
  "success": true,
  "data": {
    "roomId": "dr_abc123",
    "status": "ACTIVE",
    "purpose": "Negotiate SaaS contract with AcmeCorp",
    "createdAt": "2026-04-21T08:45:00Z",
    "createdBy": "user:erik@bettermachine.ai",
    "participants": [
      { "id": "agent:sales-agent@acme.com", "role": "negotiator", "joinedAt": "2026-04-21T08:47:00Z" }
    ],
    "policy": { ... },
    "stats": {
      "contextEntries": 12,
      "decisions": 1,
      "auditEvents": 47
    }
  }
}
```

### 5.3 POST /room/{id}/context
Add entry to context escrow.

**Request:**
```json
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
    "readableBy": ["agent:sales-agent@acme.com", "agent:legal-agent@acme.com"],
    "redactAfter": "2026-05-21T23:59:59Z"
  }
}
```

**Important:** `type: "fact"` is REQUIRED. Interpretations and opinions are rejected.

**Response:**
```json
{
  "success": true,
  "data": {
    "entryId": "ent_def456",
    "status": "ACTIVE",
    "addedAt": "2026-04-21T14:30:05Z"
  }
}
```

### 5.4 POST /room/{id}/decision/propose
Propose a decision for consensus.

**Request:**
```json
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
```

**Response:**
```json
{
  "success": true,
  "data": {
    "decisionId": "dec_ghi789",
    "status": "VOTING",
    "deadline": "2026-04-23T23:59:59Z",
    "votesRequired": 3,
    "votesReceived": 0
  }
}
```

### 5.5 POST /room/{id}/decision/vote
Cast a vote on a pending decision.

**Request:**
```json
{
  "decisionId": "dec_ghi789",
  "vote": "approve",
  "rationale": "Price within budget, terms acceptable per context escrow"
}
```

Valid votes: `approve`, `reject`, `abstain`

**Response:**
```json
{
  "success": true,
  "data": {
    "decisionId": "dec_ghi789",
    "status": "APPROVED_UNANIMOUS",
    "finalizedAt": "2026-04-22T10:15:00Z",
    "auditHash": "sha256:def456...",
    "votes": [
      { "voter": "agent:sales-agent@acme.com", "vote": "approve", "at": "2026-04-21T16:00:00Z" },
      { "voter": "user:erik@bettermachine.ai", "vote": "approve", "at": "2026-04-22T10:15:00Z" }
    ]
  }
}
```

### 5.6 GET /room/{id}/audit
Retrieve complete audit trail.

**Response:**
```json
{
  "success": true,
  "data": {
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
    ],
    "verification": {
      "algorithm": "sha256-chain",
      "rootHash": "sha256:zzz999...",
      "verified": true
    }
  }
}
```

### 5.7 POST /room/{id}/close
Close a deal room (requires consensus or creator authority).

**Request:**
```json
{
  "reason": "Contract finalized",
  "finalDocument": "contract_final.pdf",
  "hash": "sha256:contract_hash..."
}
```

---

## 6. Data Models

### 6.1 Room
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["roomId", "status", "purpose", "createdAt", "createdBy", "policy"],
  "properties": {
    "roomId": { "type": "string", "pattern": "^dr_[a-zA-Z0-9]+$" },
    "status": { "enum": ["PENDING_CONSENT", "ACTIVE", "CLOSING", "CLOSED", "ARCHIVED"] },
    "purpose": { "type": "string", "maxLength": 500 },
    "createdAt": { "type": "string", "format": "date-time" },
    "createdBy": { "type": "string", "pattern": "^(user|agent):.+$" },
    "policy": { "$ref": "#/definitions/Policy" },
    "participants": { "type": "array", "items": { "$ref": "#/definitions/Participant" } }
  }
}
```

### 6.2 ContextEntry
```json
{
  "type": "object",
  "required": ["type", "subject", "predicate", "object", "provenance"],
  "properties": {
    "type": { "const": "fact" },
    "subject": { "type": "string" },
    "predicate": { "type": "string" },
    "object": { "type": "string" },
    "provenance": {
      "type": "object",
      "required": ["source", "extractedBy", "extractedAt"],
      "properties": {
        "source": { "type": "string" },
        "extractedBy": { "type": "string" },
        "extractedAt": { "type": "string", "format": "date-time" },
        "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
      }
    },
    "verification": { "type": "string" }
  }
}
```

### 6.3 Decision
```json
{
  "type": "object",
  "required": ["decisionId", "status", "proposal", "createdAt"],
  "properties": {
    "decisionId": { "type": "string", "pattern": "^dec_[a-zA-Z0-9]+$" },
    "status": { "enum": ["VOTING", "APPROVED_UNANIMOUS", "APPROVED_MAJORITY", "REJECTED", "EXPIRED"] },
    "proposal": { "type": "object" },
    "deadline": { "type": "string", "format": "date-time" },
    "finalizedAt": { "type": "string", "format": "date-time" },
    "auditHash": { "type": "string" },
    "votes": { "type": "array", "items": { "$ref": "#/definitions/Vote" } }
  }
}
```

### 6.4 AuditEvent
```json
{
  "type": "object",
  "required": ["sequence", "timestamp", "event", "actor", "hash", "previousHash"],
  "properties": {
    "sequence": { "type": "integer", "minimum": 1 },
    "timestamp": { "type": "string", "format": "date-time" },
    "event": { "type": "string", "enum": ["ROOM_CREATED", "AGENT_JOINED", "CONTEXT_ADDED", "DECISION_PROPOSED", "VOTE_CAST", "DECISION_FINALIZED", "ROOM_CLOSED"] },
    "actor": { "type": "string" },
    "payload": { "type": "object" },
    "hash": { "type": "string", "pattern": "^sha256:[a-f0-9]{64}$" },
    "previousHash": { "type": "string" }
  }
}
```

---

## 7. A2A Integration

### 7.1 Agent Card Extension
MMP-aware agents publish extended Agent Cards:

```json
{
  "name": "Sales Negotiator Agent",
  "url": "https://agent.acme.com/a2a",
  "capabilities": {
    "mmp": {
      "version": "2.0",
      "dealRooms": {
        "canCreate": true,
        "canJoin": true,
        "maxConcurrent": 5
      }
    }
  }
}
```

### 7.2 A2A Task Types
MMP operations map to A2A tasks:

| MMP Operation | A2A Task Type |
|--------------|---------------|
| room/create | `mmp.room.create` |
| context/add | `mmp.context.add` |
| decision/propose | `mmp.decision.propose` |
| decision/vote | `mmp.decision.vote` |

### 7.3 Interoperability
Agents MAY use MMP-only endpoints OR A2A task interfaces. MMP implementations MUST support both.

---

## 8. Error Handling

### 8.1 Standard Error Codes
| Code | HTTP | Description |
|------|------|-------------|
| `UNAUTHORIZED` | 401 | Invalid or missing credentials |
| `FORBIDDEN` | 403 | Valid credentials, insufficient permissions |
| `ROOM_NOT_FOUND` | 404 | Room does not exist or access denied |
| `INVALID_REQUEST` | 400 | Malformed request |
| `INVALID_CONTEXT_TYPE` | 400 | Context entry type !== "fact" |
| `CONSENT_REQUIRED` | 403 | Room pending consent |
| `DECISION_EXPIRED` | 410 | Decision voting window closed |
| `CONSENSUS_FAILED` | 422 | Required votes not achieved |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |

### 8.2 Error Response Format
```json
{
  "success": false,
  "error": {
    "code": "INVALID_CONTEXT_TYPE",
    "message": "Context entries MUST be type: 'fact'. Interpretations are rejected.",
    "details": {
      "providedType": "interpretation",
      "rejected": true
    }
  }
}
```

---

## 9. Security Considerations

### 9.1 Cryptographic Verification
- All audit events MUST include SHA-256 hash
- Hash chain MUST verify for complete audit integrity
- Root hash SHOULD be published to immutable log (e.g., blockchain, signed timestamp service)

### 9.2 WORM Logs
- Audit logs MUST be Write Once Read Many
- No deletion or modification after write
- Retention policy enforcement MUST be automatic

### 9.3 Encryption
- Data at rest: AES-256-GCM with tenant-scoped keys
- Data in transit: TLS 1.3, mTLS for agent authentication
- Field-level encryption for PII/PHI

### 9.4 Secret Management
- API keys MUST be rotated every 90 days
- Ephemeral tokens preferred over long-lived keys
- Secrets MUST be stored in hardware security modules or equivalent

### 9.5 Access Control
- ABAC (Attribute-Based Access Control) REQUIRED
- Time-bound grants with automatic expiry
- Revocation capability for compromised credentials

---

## 10. Appendix: Example Flows

### 10.1 Complete Deal Room Lifecycle

```
1. USER creates room
   POST /room/create
   → 202 PENDING_CONSENT

2. USER approves via consent URL
   → Room status: ACTIVE

3. AGENT_A joins room
   → Audit event: AGENT_JOINED

4. AGENT_A adds context
   POST /room/dr_abc123/context
   → 200, entry added to escrow

5. AGENT_B adds context
   → Escrow now contains facts from both agents

6. AGENT_A proposes decision
   POST /room/dr_abc123/decision/propose
   → 202, decision in VOTING state

7. AGENT_B votes approve
   POST /room/dr_abc123/decision/vote
   → 200, vote recorded

8. USER votes approve
   → Consensus achieved, status: APPROVED_UNANIMOUS
   → Audit event: DECISION_FINALIZED

9. USER retrieves audit trail
   GET /room/dr_abc123/audit
   → Complete chain with verification: true

10. USER closes room
    POST /room/dr_abc123/close
    → Status: CLOSED → Archived after retention period
```

---

**End of Specification**

*For questions or contributions: github.com/Better-Machine/mesh-memory*
