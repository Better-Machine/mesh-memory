# Presence Protocol — Privacy & Security Analysis

**Status:** Draft  
**Date:** 2026-04-12  
**Scope:** RFC-0004 Presence Protocol  

---

## 1. Threat Model

### 1.1 Data Exposure Risks

| Information | Exposure Risk | Mitigation |
|-------------|---------------|------------|
| **Human identity** | High — "Erik talking to Liz" reveals relationship | Scope controls (private, selective, mesh) |
| **Topic/subject** | Medium — "mesh_memory_testing" reveals activity | Topic abstraction ("technical_discussion") |
| **Session timing** | Low — when agents are active | Inherent to protocol, acceptable |
| **Agent availability** | Low — idle vs busy status | No sensitive data revealed |

### 1.2 Attack Vectors

| Attack | Description | Likelihood | Impact |
|--------|-------------|------------|--------|
| **Presence Spoofing** | Agent A claims to be Agent B | Medium | High — confusion, wrong context |
| **Presence Flooding** | Spam presence messages | Low | Medium — noise, resource exhaustion |
| **Snooping/Inference** | Infer activity from presence patterns | High | Low — metadata analysis |
| **Replay Attack** | Rebroadcast old presence | Low | Medium — stale context |

---

## 2. Scope Controls

### 2.1 Visibility Levels

```yaml
presence_scope:
  - private          # No presence broadcast (current behavior)
  - peers: [list]    # Only specified agents see presence
  - mesh             # All mesh agents see presence
  - human_only       # Human sees presence, agents don't
```

### 2.2 Automatic Privacy Protection

| Trigger | Action |
|---------|--------|
| `[private]` marker in session | Suppress presence automatically |
| Sensitive topic keywords | Downgrade scope to `peers` or `private` |
| Human explicitly requests | Set `human_only` visibility |
| After hours (22:00-08:00) | Reduce presence detail (idle vs specific) |

---

## 3. Authentication & Integrity

### 3.1 Presence Message Signing

```json
{
  "agent": "liz",
  "timestamp": "2026-04-12T09:44:00Z",
  "session_type": "direct_message",
  "human": "erik",
  "topic": "presence_protocol_review",
  "scope": "mesh",
  "signature": "SHA256(agent_priv_key + content)"
}
```

### 3.2 Verification Rules

1. **Sender authentication** — Verify against known agent registry
2. **Timestamp freshness** — Reject messages >30s old
3. **Rate limiting** — Max 1 presence update per 5s per agent
4. **Scope enforcement** — Drop messages violating agent's visibility rules

---

## 4. Privacy-First Defaults

### 4.1 Secure by Default

| Setting | Default | Rationale |
|---------|---------|-----------|
| Presence scope | `private` | Opt-in to sharing |
| Topic detail | Abstracted | "technical_work" not "stripe_integration" |
| Human names | Pseudonymized | "human_8362390464" not "Erik" |
| Session duration | Rounded | "~5 min" not exact seconds |

### 4.2 User Control

Human can:
- Request "ghost mode" — appear offline to all agents
- Set per-agent visibility (Liz sees presence, Woodhouse doesn't)
- Review presence history (audit trail)
- Delete presence records (GDPR-style right)

---

## 5. Implementation Recommendations

### 5.1 Data Retention

| Data Type | Retention | Reason |
|-----------|-----------|--------|
| Active presence | 30s TTL | Ephemeral by design |
| Presence history | 7 days | Debugging, audit |
| Presence aggregations | 30 days | Pattern analysis (opt-in) |

### 5.2 Audit Logging

```yaml
audit_events:
  - presence_published
  - presence_received  
  - scope_changed
  - privacy_override_triggered
  - spoofing_detected
```

### 5.3 Compliance Notes

- **GDPR:** Presence is personal data (activity tracking)
- **CCPA:** Disclosure required for presence collection
- **Best practice:** Allow human to export/delete presence data

---

## 6. Open Questions

1. Should presence include **agent load/availability** ("Liz is 80% capacity")?
2. How to handle **conflicting presence** (two agents claim same human)?
3. What is the **authority model** for ghost mode (human vs agent-initiated)?

---

**Next:** Security review with Erik before RFC-0004 acceptance.
