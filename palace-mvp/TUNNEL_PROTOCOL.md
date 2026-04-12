# Tunnel Protocol — Fact/Interpretation Separation

**Version:** 1.0.0  
**Scope:** Cross-agent fact transmission via mesh-memory tunnels  
**Author:** Liz (Palace/Kingdom Architect)  
**Date:** 2026-04-12

---

## Overview

Tunnels transmit **facts** between agents. Interpretations remain private. This document defines the boundary: what CAN traverse tunnels, what CANNOT, and how to handle each.

> **Core principle:** Facts are verifiable. Interpretations are beliefs. Tunnels carry only verifiable truth.

---

## 1. Shared Facts (What CAN Go in Tunnels)

These fact types are tunnel-safe:

### 1.1 Decisions
- Recorded choices with rationale
- Who decided, when, why
- Alternatives considered and rejected

**Example:**
```json
{
  "type": "decision",
  "id": "dec-rfc-process-001",
  "content": "RFC required for all protocol changes",
  "rationale": "Prevent spec divergence between nodes",
  "decided_by": "Mr. Ross",
  "decided_at": "2026-03-21"
}
```

### 1.2 Events
- Things that happened
- Timestamps, participants, outcomes
- System state changes

**Example:**
```json
{
  "type": "event",
  "id": "evt-deploy-mesh-v0.2",
  "content": "Mesh-memory v0.2 deployed to all nodes",
  "timestamp": "2026-04-10T14:30:00Z",
  "participants": ["liz", "ray", "woodhouse"],
  "outcome": "success"
}
```

### 1.3 Dates and Deadlines
- Calendar events
- Milestones
- Expiration dates for facts

**Example:**
```json
{
  "type": "date",
  "id": "date-hockeyops-deadline",
  "content": "Bank contribution deadline",
  "date": "2026-04-30",
  "context": "HockeyOps LLC setup"
}
```

### 1.4 Configuration
- Environment settings
- Endpoint URLs
- Feature flags

**Example:**
```json
{
  "type": "config",
  "id": "cfg-ray-receiver",
  "content": "Ray receiver endpoint updated",
  "value": "http://192.168.50.22:18803",
  "effective_from": "2026-04-11T20:00:00Z"
}
```

### 1.5 Observations
- Measurable facts
- Log entries
- Status checks

**Example:**
```json
{
  "type": "observation",
  "id": "obs-ray-l2-fail",
  "content": "Ray L2 health check timeout from Liz",
  "observed_by": "liz",
  "observed_at": "2026-04-11T20:45:00Z",
  "measurement": "timeout after 5000ms"
}
```

---

## 2. Private Interpretations (What CANNOT Go in Tunnels)

These remain local to each agent:

### 2.1 Assessments
- Performance evaluations of peers
- Trust scores (computed locally, not shared)
- Quality judgments

**NOT tunnel-safe:** "Ray's receiver is unreliable."
**Tunnel-safe:** "Ray receiver timeout observed 3x in 10min window."

### 2.2 Opinions
- Strategic preferences
- Design taste
- Priority weightings

**NOT tunnel-safe:** "We should prioritize Phase 2 over Phase 1."
**Tunnel-safe:** "RFC-0003 for Phase 2 submitted for review."

### 2.3 Predictions
- Forecasts about future events
- Confidence intervals
- Risk assessments (unless quantified as facts)

**NOT tunnel-safe:** "Woodhouse will probably miss the deadline."
**Tunnel-safe:** "Woodhouse deadline is 2026-04-15 (72 hours from now)."

### 2.4 Emotional Readings
- Interpretations of user mood
- Sentiment analysis
- "Seems frustrated" assessments

**NOT tunnel-safe:** "Erik seemed frustrated with the delay."
**Tunnel-safe:** "Erik asked for status update at 2026-04-11T21:00:00Z."

---

## 3. Tunnel Mechanics

### 3.1 Publication

Agents publish facts via shared-pool or thread context:

```javascript
// Writing to shared pool
import { publishFact } from './shared-pool-write.mjs';

await publishFact({
  type: 'decision',
  id: 'dec-example-001',
  content: 'New fact format adopted',
  provenance: {
    source: 'liz',
    timestamp: new Date().toISOString()
  }
});
```

### 3.2 Relay

Facts propagate through mesh-memory relay:

```
Agent A (source)
    ↓ writes to
shared-pool.json
    ↓ polled by
memory-relay.mjs
    ↓ HTTP POST to
Agent B, C (peers)
    ↓ written to
memory/mesh/gates/
```

### 3.3 Consumption

Receiving agents:
1. Validate provenance (see Section 5)
2. Check fact integrity (hash matching)
3. Store in local critical-facts database
4. **Generate own interpretations locally** (not shared)

---

## 4. Provenance Requirements

Every tunnel fact MUST include:

| Field | Description | Example |
|-------|-------------|---------|
| `source` | Agent ID that originated the fact | `"liz"` |
| `timestamp` | ISO 8601 timestamp | `"2026-04-12T09:23:00Z"` |
| `source_version` | Schema version | `"1.0.0"` |
| `signature` | Optional: Ed25519 signature | `"sig:..."` |

**Minimal provenance block:**
```json
{
  "provenance": {
    "source": "liz",
    "timestamp": "2026-04-12T09:23:00Z",
    "source_version": "1.0.0"
  }
}
```

**With signature (future):**
```json
{
  "provenance": {
    "source": "liz",
    "timestamp": "2026-04-12T09:23:00Z",
    "source_version": "1.0.0",
    "signature": "sig:ed25519:abc123...",
    "public_key_hash": "sha256:def456..."
  }
}
```

---

## 5. Validation

Receiving agents verify facts before incorporation:

### 5.1 Structural Validation
- Required fields present
- Timestamp parseable
- Category matches allowed values

### 5.2 Source Verification
- Source agent ID in known peers list
- Timestamp within acceptable drift (±5 minutes)
- Not expired (if `expires_at` set)

### 5.3 Integrity Verification (future)
- Signature matches source public key
- Content hash matches declared hash
- No replay (fact ID not seen before)

### 5.4 Rejection Criteria

Facts SHOULD be rejected when:
- Missing required provenance fields
- Source unknown or untrusted
- Timestamp in future or >24h old
- Duplicate ID already processed
- Expired (`expires_at` < now)
- Contains forbidden interpretation language

---

## 6. Examples

### Valid Tunnel Fact
```json
{
  "id": "evt-deploy-001",
  "tier": "critical",
  "category": "events",
  "type": "event",
  "content": {
    "title": "Memory receiver deployed",
    "body": "Liz mesh-memory receiver now running on port 18803"
  },
  "provenance": {
    "source": "liz",
    "timestamp": "2026-04-12T09:23:00Z"
  },
  "updated_at": "2026-04-12T09:23:00Z",
  "expires_at": null
}
```

### Invalid (Interpretation)
```json
{
  "id": "interpret-001",
  "type": "interpretation",
  "content": "Ray probably forgot to start his receiver",
  "provenance": { "source": "liz", "timestamp": "..." }
}
// REJECTED: type=interpretation not in allowed set
```

### Valid Observation (vs Invalid Assessment)
```json
// VALID - observation
{
  "type": "observation",
  "content": "Ray receiver health check returned timeout after 5000ms"
}

// INVALID - assessment
{
  "type": "assessment",
  "content": "Ray's receiver is unreliable and needs attention"
}
```

---

## 7. Schema Summary

```
TunnelFact:
  id: string (unique)
  tier: "critical" | "deep"
  category: "standing_instructions" | "projects" | "people" | "infrastructure" | "blockers" | "events"
  type: "decision" | "event" | "date" | "config" | "observation"
  content:
    title: string
    body: string
    tags: string[]
  provenance:
    source: string (agent ID)
    timestamp: ISO8601
    source_version: string
    signature?: string
  updated_at: ISO8601
  expires_at: ISO8601 | null
  relations?: Array<{
    relates_to: string
    relation_type: "supersedes" | "depends_on" | "related_to" | "contradicts"
  }>
```

---

## References

- `ARCHITECTURE.md` — Mesh-memory layer design
- `AGENT_GUIDELINES.md` — Agent operating procedures
- `BIAS_PROPAGATION_RESEARCH.md` — Why interpretations stay private
- `rfcs/` — Formal protocol specifications

---

*Document version: 1.0.0 — 2026-04-12*  
*Next review: When RFC-0001 (Fact Tunnel Protocol) is ratified*
