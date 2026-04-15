# RFC-0001: Token Management System for Cross-Session Memory

**Status:** Draft  
**Author(s):** Liz (coordinated by), backend-architect, api-tester  
**Created:** 2026-04-11  
**Last Updated:** 2026-04-11

---

## Summary

This RFC proposes a production-grade token management system for mesh-memory that enables cryptographic identity binding, prevents impersonation, and supports secure cross-session authentication. The current POC uses random hex tokens that allow any token holder to impersonate any agent. The MVP requires tokens cryptographically bound to agent identity with revocation support.

---

## Motivation

The current mesh-memory implementation (`identity-resolver.mjs`, `thread-context.mjs`) uses randomly generated hex strings as tokens. These tokens:

1. **Allow impersonation:** Any token holder can write events claiming to be any agent
2. **Cannot be revoked:** Once issued, tokens remain valid until expiry or thread close
3. **Have no binding:** No cryptographic link between token and agent identity

This creates a security vulnerability where a compromised token file allows indefinite impersonation across sessions. The 4 AM hard reset boundary makes this worse — sessions cannot rely on in-memory token validation state.

Without this RFC, the MVP cannot guarantee agent identity integrity in a multi-agent mesh.

---

## Prior Art / Existing Approaches

### JWT (JSON Web Tokens)
- **Relevant:** Industry standard for stateless auth with claims
- **Approach:** HMAC-SHA256 or EdDSA signatures, `sub` claim for subject identity
- **Trade-off:** Stateless validation vs. token size overhead

### mTLS (Mutual TLS)
- **Relevant:** Strong identity binding via X.509 certificates
- **Approach:** Certificate-based authentication at transport layer
- **Trade-off:** High setup complexity, requires PKI infrastructure

### Macaroons (Google)
- **Relevant:** Context-aware authorization with caveats
- **Approach:** Token with embedded caveats for scope/time/location
- **Trade-off:** More complex than needed for current scope

### Our Current POC (`blind-gate.mjs`, `thread-context.mjs`)
- Random 32-byte hex tokens stored in `tokens.json`
- No validation that token holder matches claimed identity
- 10-minute expiry for blind gates, thread-scoped for ephemeral tokens

**Decision:** MVP adopts JWT-like structure with HMAC-SHA256 (upgrade path to EdDSA). mTLS deferred to Phase 3 enterprise hardening.

---

## Detailed Design

### Token Structure (JWT-like)

```json
{
  "header": {
    "alg": "HS256",
    "typ": "JWT"
  },
  "payload": {
    "sub": "agent:liz",           // Agent identity (bound)
    "iss": "mesh-memory",          // Issuer
    "aud": "mesh-receiver",        // Audience
    "iat": 1744416000,             // Issued at (Unix seconds)
    "exp": 1744419600,             // Expiry (Unix seconds)
    "jti": "uuid-token-id",        // Unique token ID (revocation lookup)
    "scope": "write:shared-pool",  // Permission scope
    "tid": "thread-uuid"           // Optional: thread binding
  },
  "signature": "HMAC-SHA256(...)"
}
```

Encoded as Base64Url: `base64url(header).base64url(payload).signature`

### Validation Logic

```javascript
function validateToken(token, requiredScope, claimedAgentId) {
  // 1. Parse and verify structure
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');
  
  // 2. Verify signature
  const expectedSig = hmacSha256(parts[0] + '.' + parts[1], SECRET_KEY);
  if (!timingSafeEqual(parts[2], expectedSig)) throw new Error('Invalid signature');
  
  // 3. Decode payload
  const payload = JSON.parse(base64urlDecode(parts[1]));
  
  // 4. Verify expiry
  if (payload.exp < Date.now() / 1000) throw new Error('Token expired');
  
  // 5. Verify revocation
  if (isRevoked(payload.jti)) throw new Error('Token revoked');
  
  // 6. Verify scope
  if (!hasScope(payload.scope, requiredScope)) throw new Error('Insufficient scope');
  
  // 7. CRITICAL: Verify agent binding
  if (payload.sub !== claimedAgentId) throw new Error('Agent mismatch');
  
  return payload;
}
```

### API Endpoint Changes

#### `POST /v1/shared-pool` (Write)

**Request:**
```json
{
  "token": "eyJhbGciOiJIUzI1Ni...",
  "agentId": "agent:liz",  // Must match token.sub
  "entry": {
    "id": "uuid-entry",
    "type": "fact",
    "content": "...",
    "timestamp": "2026-04-11T21:00:00Z"
  },
  "idempotencyKey": "uuid-request"  // For exactly-once semantics
}
```

**Response (200):**
```json
{
  "ok": true,
  "receipt": {
    "id": "uuid-entry",
    "confirmedAt": "2026-04-11T21:00:01.234Z",
    "checkpointId": "cp-uuid"
  }
}
```

**Response (401 - Agent Mismatch):**
```json
{
  "error": "Agent mismatch",
  "detail": "Token subject (agent:ray) does not match claimed agentId (agent:liz)"
}
```

### Token Lifecycle

1. **Issuance:** `POST /v1/tokens/issue` (admin/receiver only)
2. **Validation:** On every authenticated request
3. **Revocation:** `POST /v1/tokens/revoke/{jti}`
4. **Expiry:** Automatic after `exp` time
5. **Rotation:** Re-issue before expiry, update configs atomically

### Revocation Store

SQLite table:
```sql
CREATE TABLE token_revocations (
  jti TEXT PRIMARY KEY,
  revoked_at INTEGER NOT NULL,  -- Unix seconds
  reason TEXT
);

-- Cleanup job removes entries older than 30 days
```

### Secret Management

- HMAC secret stored in `~/.openclaw/mesh/secrets/token-key`
- File permissions: 0600 (owner read/write only)
- Key rotation: New key generated, old key accepted for 24h grace period
- Backup: Key encrypted to Erik's GPG key, stored offline

---

## Alternatives Considered

| Alternative | Why Considered | Why Rejected |
|-------------|---------------|--------------|
| Keep random hex tokens | Minimal change | No identity binding, impersonation trivial |
| mTLS with X.509 | Strongest security | Setup complexity too high for MVP timeline |
| Macaroons | Context-aware auth | Over-engineered for current scope |
| EdDSA signatures | Post-quantum readiness | HMAC-SHA256 sufficient, upgrade path defined |
| Token binding via IP | Simple to implement | Agents move between nodes (Ray hardware upgrade) |

---

## Impact Assessment

### Breaking Changes
- [x] **Breaking change** — All existing tokens invalidated
- **Migration path:** 
  1. Deploy new token system alongside old (dual validation)
  2. Re-issue tokens to all agents
  3. Remove old validation after 24h

### Affected Components
- `identity-resolver.mjs` — Add JWT validation
- `thread-context.mjs` — Issue/validate ephemeral tokens
- `blind-gate.mjs` — Issue/validate gate tokens
- `memory-receiver.mjs` — Validate all incoming requests
- `config.mjs` — Add secret key path

### Security Considerations
- HMAC secret file permissions must be 0600 (enforced on load)
- Timing-safe equality for signature verification (prevents timing attacks)
- Token expiry prevents indefinite replay if token leaked
- Revocation allows immediate invalidation if compromise suspected

### Performance Considerations
- HMAC-SHA256: ~1μs per validation (negligible overhead)
- Token size: ~300-400 bytes (vs. 64 bytes for hex tokens)
- Revocation check: O(1) Bloom filter + O(log n) SQLite lookup

### Twelve-Factor Considerations
- Secrets externalized to file (not in config)
- Token state stored in backing service (SQLite), not in-process

---

## Open Questions

1. Should we implement EdDSA (ed25519) now for quantum resistance, or defer to Phase 3?
2. Should tokens include a `node` claim binding to specific hardware? (Complicates agent portability)
3. What's the appropriate token expiry? 1 hour? 24 hours? Thread-lifetime?

---

## Review Checklist

Before Draft → Under Review:
- [ ] Prior art section complete
- [x] At least one concrete example provided
- [x] Alternatives considered section complete
- [x] Breaking changes explicitly called out
- [x] Security considerations addressed

Before Under Review → Accepted:
- [ ] All three agents review and comment
- [ ] Erik approves
- [ ] Open questions resolved
- [ ] Affected components list finalized

---

## Decision

**Decision:** [Pending]  
**Decision date:** [Pending]  
**Decided by:** [Pending]

---

## Implementation Notes

*To be filled after acceptance.*
