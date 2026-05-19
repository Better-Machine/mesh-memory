# RFC-0001: Gatehouse — Secure Agent Collaboration

**Status:** Draft  
**Author:** Liz (Head of Incubator & Development)  
**Date:** 2026-05-19  
**Target Version:** mesh-memory v2.0  

---

## Summary

Gatehouse is a secure escrow service for multi-agent collaboration, extending the Palace memory architecture (L0-L4) with controlled data sharing, immutable audit trails, and cryptographic verification.

**Core Concept:** Agents deposit sensitive context into a shared escrow, which only releases when all parties approve — like a gatehouse that checks credentials before raising the portcullis.

---

## Motivation

### Problem
Agents in the Better Machine fleet need to share sensitive information (task context, decisions, action items) without:
- Exposing raw data until all parties agree
- Losing accountability for who shared what
- Risking unauthorized access by non-participants

### Current State
- Palace L0-L4: Individual agent memory ✅
- Cross-agent sharing: Ad-hoc A2A messages (deprecated)
- Security: No escrow mechanism

### Desired State
- Escrowed data sharing with multi-party approval
- Immutable audit trails for compliance
- Agent vaults for private data holdings
- Cryptographic verification of shared context

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    GATEHOUSE SYSTEM                        │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ Agent Vault │  │   Escrow    │  │   Audit     │         │
│  │   (L1+)     │  │   (L2+)     │  │   (L3)      │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│         │                 │                 │                │
│         └─────────────────┴─────────────────┘                │
│                           │                                  │
│                    ┌─────────────┐                          │
│                    │  Gatehouse  │                          │
│                    │    API      │                          │
│                    │  Port 18811 │                          │
│                    └─────────────┘                          │
│                           │                                  │
│         ┌─────────────────┼─────────────────┐               │
│         │                 │                 │               │
│    ┌────▼────┐       ┌────▼────┐       ┌────▼────┐          │
│    │   Liz   │◄─────►│   Ray   │◄─────►│Woodhouse│          │
│    │Palace   │       │Palace   │       │Palace   │          │
│    │Port18810│       │Port18810│       │Port18810│          │
│    └─────────┘       └─────────┘       └─────────┘          │
└─────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. Agent Vault (Private Holdings)
- **Purpose:** Each agent's private data, encrypted at rest
- **Scope:** L1 Critical Facts + L2 Deep Memory
- **Access:** Agent-only, no cross-agent sharing
- **Storage:** SQLite per agent

### 2. Escrow (Shared Data)
- **Purpose:** Collaboration data pending release
- **Workflow:**
  1. Initiator deposits encrypted payload
  2. Recipients review (metadata visible, payload encrypted)
  3. Multi-party approval required (configurable threshold)
  4. Escrow releases, all parties retrieve decrypted data
- **Encryption:** AES-256-GCM per deal
- **Keys:** Ephemeral, derived from deal parameters

### 3. Audit Trail (Immutable Record)
- **Purpose:** Compliance, debugging, trust verification
- **Stored:** Every action (create, approve, reject, retrieve, expire)
- **Integrity:** Chain hashes linking entries
- **Retention:** Configurable (default 365 days)

### 4. Gatehouse API
- **Port:** 18811 (separate from Palace daemon 18810)
- **Protocol:** HTTP/REST + JSON
- **Security:** CORS for cross-origin, future: mTLS

---

## API Specification

### Health
```http
GET /health
Response: {"success": true, "data": {"status": "healthy"}}
```

### Create Deal
```http
POST /deals
Body: {
  "initiator": "agent-liz",
  "recipient": "agent-ray",
  "payload": {"task": "clean-sl8-review", "data": {...}},
  "conditions": {
    "requiredApprovals": ["agent-liz", "agent-ray"],
    "timeout": 86400000  // 24 hours
  }
}
Response: {
  "success": true,
  "data": {
    "dealId": "deal_xxx",
    "status": "pending",
    "expiresAt": "2026-05-20T..."
  }
}
```

### Approve/Reject
```http
POST /deals/{dealId}/approve
Body: {
  "agentId": "agent-ray",
  "action": "approve"  // or "reject"
}
Response: {
  "success": true,
  "data": {
    "dealId": "deal_xxx",
    "status": "released",  // or "rejected"
    "timestamp": "2026-05-19T..."
  }
}
```

### Retrieve Payload (Released Only)
```http
POST /deals/{dealId}/payload
Body: {"agentId": "agent-ray"}
Response: {
  "success": true,
  "data": {
    "dealId": "deal_xxx",
    "payload": {...},  // Decrypted
    "retrievedBy": "agent-ray",
    "timestamp": "2026-05-19T..."
  }
}
```

### List Deals
```http
GET /deals?agent=agent-ray&status=pending
Response: {
  "success": true,
  "data": {
    "deals": [...],
    "count": 5
  }
}
```

### Audit Trail
```http
GET /deals/{dealId}/audit
Response: {
  "success": true,
  "data": {
    "dealId": "deal_xxx",
    "entries": [
      {"action": "CREATE", "actor": "agent-liz", "timestamp": "..."},
      {"action": "APPROVE", "actor": "agent-liz", "timestamp": "..."},
      {"action": "APPROVE", "actor": "agent-ray", "timestamp": "..."},
      {"action": "RETRIEVE", "actor": "agent-ray", "timestamp": "..."}
    ]
  }
}
```

---

## Security Model

### Threat Model
| Threat | Mitigation |
|--------|------------|
| Unauthorized access | Agent identity verification, party-only access |
| Tampered audit logs | Chain hashes, append-only log |
| Key compromise | Ephemeral keys per deal, derived from parameters |
| Replay attacks | Timestamp validation, deal expiration |
| Eavesdropping | TLS (future), payload encrypted at rest |

### Trust Boundaries
- **Inside Gatehouse:** Encrypted data, audit logs
- **Between agents:** HTTPS (future: mTLS)
- **Agent endpoints:** Palace L0 identity verification

---

## Implementation Status

| Component | Status | File |
|-----------|--------|------|
| Core escrow | ✅ Complete | `deal-room.mjs` |
| HTTP API | ✅ Complete | `deal-room-api.mjs` |
| Unit tests | ✅ 10/10 passing | `test-deal-room.mjs` |
| Agent vault | 🔄 Scaffolded | `deal-room.mjs` |
| systemd service | ⏳ Not started | - |
| Cross-agent test | ⏳ Blocked | - |
| TLS/mTLS | ⏳ Future | - |

---

## Deployment

### Per-Node Setup
```bash
# Each agent node (Liz, Ray, Woodhouse)
cd ~/.openclaw/workspace/projects/mesh-memory

# Palace daemon (port 18810)
systemctl --user start palace-daemon

# Gatehouse API (port 18811)
node deal-room-api.mjs
```

### Fleet Topology
```
Liz (.23)          Ray (.22)          Woodhouse (.24)
├─ Palace:18810    ├─ Palace:18810    ├─ Palace:18810
└─ Gatehouse:18811  └─ Gatehouse:18811  └─ Gatehouse:18811
      │                   │                   │
      └───────────────────┴───────────────────┘
                   (Cross-agent calls)
```

---

## Integration with Palace

### Wake-Up Context
When an agent starts, Palace loads:
1. L0: Identity (who am I?)
2. L1: Critical facts (projects, preferences)
3. L2: Deep memory (search on demand)

Gatehouse extends this:
4. **Pending deals:** Any escrowed data waiting for approval
5. **Active collaborations:** Ongoing multi-agent sessions

### Example Workflow
```javascript
// Liz wakes up, Palace loads context
const palace = await createPalace();
await palace.init();

// Check Gatehouse for pending deals
const pending = await fetch('http://localhost:18811/deals?agent=agent-liz&status=pending');
if (pending.data.count > 0) {
  // Resume collaboration
  await palace.loadDealContext(pending.data.deals);
}

// Create new deal
const deal = await fetch('http://localhost:18811/deals', {
  method: 'POST',
  body: JSON.stringify({
    initiator: 'agent-liz',
    recipient: 'agent-ray',
    payload: { /* sensitive context */ }
  })
});

// Ray approves (from his node)
await fetch('http://192.168.50.22:18811/deals/${dealId}/approve', {
  method: 'POST',
  body: JSON.stringify({ agentId: 'agent-ray', action: 'approve' })
});

// Liz retrieves released payload
const payload = await fetch('http://localhost:18811/deals/${dealId}/payload', {
  method: 'POST',
  body: JSON.stringify({ agentId: 'agent-liz' })
});
```

---

## Future Work

### Phase 1 (Current)
- Core escrow and approval flow ✅
- Basic HTTP API ✅
- SQLite backend ✅

### Phase 2 (Next)
- [ ] systemd service for Gatehouse API
- [ ] Cross-agent testing (Liz ↔ Ray ↔ Woodhouse)
- [ ] TLS for inter-agent communication
- [ ] Agent vault full implementation
- [ ] WebSocket for real-time notifications

### Phase 3 (Later)
- [ ] mTLS for agent authentication
- [ ] Distributed consensus (L4 Kingdom)
- [ ] Deal templates (common patterns)
- [ ] Integration with CleanSL8, HockeyOps, etc.

---

## Naming

**Gatehouse** — The controlled entrance to a castle where credentials are verified and passage is granted.

- Portcullis: Considered, implies barrier
- Vault: Considered, overused
- **Gatehouse**: Chosen, implies controlled access

---

## References

- Palace Memory Architecture (`PALACE.md`)
- Deal Room Core (`deal-room.mjs`)
- Deal Room API (`deal-room-api.mjs`)
- Test Suite (`test-deal-room.mjs`)

---

**Next Steps:**
1. Finalize brand name ✅ (Gatehouse)
2. Complete Ray/Woodhouse deployment
3. Cross-agent testing
4. Production hardening
