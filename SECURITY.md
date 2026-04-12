# Security Model — mesh-memory Palace

**Version:** 1.0.0  
**Last Updated:** 2026-04-12  
**Scope:** Palace MVP and mesh-memory infrastructure

---

## Overview

This document defines the security model for mesh-memory Palace, including threat boundaries, credential handling, logging policies, and privacy guarantees.

## Threat Model

### Trusted Boundaries

| Zone | Trust Level | Contains |
|------|-------------|----------|
| Local machine | High | Agent process, SQLite DB, config files |
| Local network (192.168.50.0/24) | Medium | Peer agents, inference endpoints |
| Tunnel protocol | Medium | Cross-agent fact transmission |
| Public internet | Untrusted | Health probes, external APIs |

### Threats Addressed

1. **Credential leakage** — Tokens in logs, config commits
2. **LAN fingerprinting** — Internal IP exposure in repos
3. **Fact spoofing** — Unverified provenance on tunnel facts
4. **Interpretation contamination** — Bias propagation via shared beliefs

## Credential Handling

### Token Storage

```
Priority (highest to lowest):
1. Environment variables (TUNNEL_TOKEN, MESH_RECEIVER_TOKEN)
2. Local config file (mesh-memory.config.local.json) — gitignored
3. Base config (mesh-memory.config.json) — placeholder values only
```

**Rule:** Never commit tokens to version control. Use `.local.json` overrides.

### Token Transmission

- Tunnel endpoints use `Authorization: Bearer <token>`
- Tokens are **never logged** (sanitized before logging)
- Failed auth returns generic 401 (no token hints)

### Token Rotation

- Gate commitments use ephemeral tokens (10-minute TTL)
- Peer tokens should rotate on suspicion of compromise
- See `blind-gate.mjs` for commitment protocol

## Logging Sanitization

### Sanitized Fields

The following are automatically redacted from logs:

| Field | Redaction | Example Output |
|-------|-----------|--------------|
| `token` | `[REDACTED]` | `Bearer [REDACTED]` |
| `peer.token` | `[REDACTED]` | Peer URL logged, token omitted |
| `Authorization` header | `[REDACTED]` | Header name shown, value redacted |
| Passwords/keys | `[REDACTED]` | Any key matching `/pass(word)?|secret|key/i` |

### Implementation

```javascript
// Use sanitizeMeta() before logging objects that may contain tokens
function sanitizeMeta(meta) {
  if (!meta || typeof meta !== "object") return meta;
  const sanitized = {};
  for (const [key, value] of Object.entries(meta)) {
    if (/token|password|secret|key|authorization/i.test(key)) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object") {
      sanitized[key] = sanitizeMeta(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
```

## Privacy Boundaries

### What CAN Traverse Tunnels (Facts)

- Decisions with rationale
- Events with timestamps
- Configuration changes
- Observations (measurements)
- Dates/deadlines

### What CANNOT Traverse Tunnels (Interpretations)

- Performance assessments of peers
- Trust scores
- Strategic opinions
- Sentiment analysis
- Predictions/forecasts

See `palace-mvp/TUNNEL_PROTOCOL.md` for detailed separation rules.

## LAN IP Policy

### Commit Rules

| Location | IP Allowed? | Rule |
|----------|-------------|------|
| `agent-passport.json` | Yes | Local file, not committed to public repo |
| `palace-mvp/` | No | Template/schema only, use placeholders |
| `docs/` | No | Use `192.168.x.x` as placeholder |
| Tests | Caution | Mock IPs preferred |

### Placeholder Pattern

```json
{
  "host": "192.168.x.x",
  "_comment": "Replace with actual LAN IP before deployment"
}
```

## Validation Requirements

### Incoming Facts (Tunnel)

Before accepting a fact from a peer:

1. **Structural validation** — Required fields present
2. **Source verification** — Known peer list
3. **Timestamp validation** — Within ±5min drift, not >24h old
4. **Interpretation filter** — Block keywords (believes, thinks, etc.)
5. **Duplicate check** — ID not already processed

### Implementation

```javascript
const validation = validateFact(fact);
if (!validation.valid) {
  return res.status(400).json({ error: "Validation failed" });
}
```

## Incident Response

### Suspected Credential Leak

1. Rotate the token immediately
2. Check audit logs for unauthorized access
3. Review recent commits for accidental exposure
4. Update `SECURITY.md` with lessons learned

### Privacy Violation (IP/token in repo)

1. Remove from repository history (git filter-branch or BFG)
2. Rotate exposed credentials
3. Update `.gitignore` if needed
4. Document in post-mortem

## QA Gate: Security Checklist

Before any merge:

```bash
# 1. No LAN IPs in source
rg "192\.168\." src/ palace-mvp/ || echo "✓ No LAN IPs"

# 2. No hardcoded secrets
rg -i "sk-[a-zA-Z0-9]{20,}" src/ palace-mvp/ || echo "✓ No API keys"
rg -i "token.*['\"][a-f0-9]{20,}" src/ palace-mvp/ || echo "✓ No hardcoded tokens"

# 3. No absolute paths
rg "/home/" src/ palace-mvp/ || echo "✓ No absolute home paths"

# 4. Verify .gitignore includes local config
rg "\.local\.json" .gitignore || echo "WARNING: .local.json not gitignored"
```

## Compliance

- Standing policy: NEVER commit tokens, LAN IPs, or credentials
- RFC required for: Protocol changes, auth mechanisms, tunnel format changes
- ADR required for: Architectural security decisions

## References

- `palace-mvp/TUNNEL_PROTOCOL.md` — Fact/interpretation separation
- `palace-mvp/critical-facts.schema.json` — Fact validation schema
- `blind-gate.mjs` — Commitment protocol
- `tunnel-publisher.mjs` — Tunnel implementation
