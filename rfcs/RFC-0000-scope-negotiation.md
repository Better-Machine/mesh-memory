# RFC-0000: OAuth 2.0 Scope Negotiation for A2A Mesh

**Status:** Draft  
**Author:** Liz (Agentcy.services)  
**Date:** 2026-04-10  

---

## Abstract

In a decentralized Agent-to-Agent (A2A) mesh, autonomous agents must discover, agree upon, and enforce capabilities at runtime. This document extends OAuth 2.0 scope semantics to peer-to-peer mesh topologies: agents exchange scope proposals during connection establishment, negotiate a mutually acceptable scope set, bind it to access tokens, and validate scopes continuously. The protocol defines deterministic scope reduction for reconnection after failures, enabling graceful degradation while preserving security. By reusing OAuth 2.0 token introspection [RFC7662] and circuit-breaker patterns, the solution integrates with existing identity infrastructure while providing fault tolerance for large-scale A2A meshes.

---

## 1. Terminology

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" are to be interpreted as described in BCP 14 [RFC2119] [RFC8174].

* **Agent** — An autonomous entity participating in the A2A mesh, capable of initiating and accepting connections, exposing scoped capabilities, and consuming peer services.
* **Scope** — A string identifier denoting a capability (e.g., `read:profile`, `write:command`, `admin:mesh`). Follows OAuth 2.0 syntax [RFC6749] Section 3.3.
* **Scope Proposal** — The list of scopes an agent requests from a peer during connection setup.
* **Negotiated Scope Set** — The intersection of initiator and responder scope proposals, agreed upon for the connection lifetime.
* **Access Token** — OAuth 2.0 Bearer token [RFC6750] encoding the negotiated scope set.
* **Token Introspection Endpoint** — AS endpoint [RFC7662] returning token metadata including scopes.
* **Circuit Breaker** — Fault-tolerance pattern halting requests to failing peers after error thresholds.
* **Reconnection** — Re-establishing an A2A link after transient failure.
* **Scope Reduction** — Deriving a lesser-privileged scope set for reconnection when full scopes unavailable.

---

## 2. Problem Statement

A2A meshes require dynamic link formation with least-privilege enforcement. Static mTLS with role-based access requires pre-provisioned policies and lacks runtime discovery. Standard OAuth 2.0 client-credentials assumes a trusted AS knowing all possible scopes, which fails when agents expose novel, domain-specific capabilities ad-hoc.

Without standardized negotiation, developers resort to ad-hoc handshakes or wildcard scopes, causing:

* **Security drift** — Over-privileged tokens persist after peer downgrades.
* **Interoperability friction** — Agents cannot reliably discover capabilities.
* **Fault-intolerance** — Reconnection retries same scopes or falls back to anonymous access.

A scoped negotiation protocol compatible with OAuth 2.0, supporting dynamic discovery and deterministic scope reduction, is required.

---

## 3. Prior Art

* **[RFC6749]** OAuth 2.0 Authorization Framework — Defines scopes, tokens, and grants. Section 3.3 describes scope handling during issuance.
* **[RFC7662]** OAuth 2.0 Token Introspection — Standardized method for resource servers to query token metadata including scopes from the AS.
* **[RFC6750]** OAuth 2.0 Bearer Token Usage — Specifies Bearer token transport in HTTP requests.
* **[gRPC]** — HTTP/2-based RPC framework with keepalive, exponential backoff reconnection, and channel state tracking for transport resilience.
* **[CB]** Circuit Breaker Pattern — State-machine pattern (closed/open/half-open) for fault tolerance, distinguishing authorization vs infrastructure failures.

These establish foundations: negotiated permissions [RFC6749], runtime validation [RFC7662], transport resilience [gRPC], and fault containment [CB].

---

## 4. Proposed Solution

### 4.1 Scope Exchange Protocol

During A2A connection establishment, agents perform a three-message handshake:

```
Agent A (Initiator)          Agent B (Responder)
     |                              |
     |--- (1) HELLO_PROPOSAL ----->|
     |    [scopes: A wants]       |
     |                              |
     |<-- (2) HELLO_RESPONSE -----|
     |    [scopes: intersection] |
     |                              |
     |--- (3) ACK ---------------->|
     |    [token request]         |
```

**Message 1: HELLO_PROPOSAL**
- Agent A sends its scope proposal: list of capabilities it needs from B.
- Format: JSON array of scope strings.

**Message 2: HELLO_RESPONSE**
- Agent B computes intersection of A's proposal with B's supported scopes.
- Applies local policy to further restrict.
- Returns negotiated scope set or `invalid_scope` error.

**Message 3: ACK**
- Agent A accepts negotiated scopes.
- Requests access token from AS bound to negotiated set.
- Connection established.

### 4.2 Negotiation Algorithm

```
function negotiate(client_proposal, server_supported, policy):
    intersection = client_proposal ∩ server_supported
    negotiated = apply_policy(intersection, policy)
    
    if negotiated.is_empty():
        return ERROR_INVALID_SCOPE
    
    return negotiated
```

Properties:
- Client never receives more than requested.
- Server never grants unsupported scopes.
- Policy can further restrict (e.g., deny `admin:*` for external agents).

### 4.3 Token Binding

The access token issued by the AS MUST:
1. Include the negotiated scope set in the `scope` claim.
2. Be bound to the specific A2A connection (via TLS session or token binding [RFC8471]).
3. Be validated by the resource server on each request via introspection [RFC7662].

If token scope does not match the connection's negotiated set, the request MUST be rejected with 401 Unauthorized.

### 4.4 Runtime Validation

Resource servers validate each request:

1. Extract Bearer token from Authorization header [RFC6750].
2. Call AS token introspection endpoint [RFC7662].
3. Verify token `active` is true.
4. Verify token `scope` matches connection's negotiated scope set.
5. Verify requested operation is within scope set.

Cache introspection responses for TTL specified by AS to reduce latency.

### 4.5 Reconnection with Scope Reduction

When reconnection fails with full negotiated scope set:

```
function reconnect_with_reduction(original_scopes):
    for reduced_set in scope_reduction_chain(original_scopes):
        try:
            connect_with_scopes(reduced_set)
            return SUCCESS, reduced_set
        except CONNECTION_FAILED:
            continue
    
    return FAILURE
```

**Scope Reduction Chain:**
Deterministic ordering from most to least privileged:
```
original_set → remove(admin scopes) → 
               remove(write scopes) → 
               remove(read scopes) → 
               empty (fail)
```

This ensures graceful degradation while maintaining security.

### 4.6 Circuit Breaker Integration

The circuit breaker pattern [CB] distinguishes:
- **Authorization failures** (4xx) — Do NOT open breaker; may succeed with reduced scopes.
- **Infrastructure failures** (5xx, timeout) — Open breaker after threshold.

Breaker states:
- **CLOSED** — Normal operation, requests pass through.
- **OPEN** — After threshold failures, requests fail fast.
- **HALF-OPEN** — After timeout, allow test request with reduced scopes.

---

## 5. Security Considerations

### 5.1 Token Scope Binding
Tokens MUST be cryptographically bound to the negotiated scope set and connection context to prevent scope escalation attacks.

### 5.2 Scope Reduction Validation
Reduced scope sets MUST be logged and auditable. Reconnection with reduced scopes SHOULD trigger security event logging.

### 5.3 Introspection Endpoint Security
The token introspection endpoint MUST require authentication and rate limiting to prevent abuse [RFC7662].

### 5.4 Clock Synchronization
Agents SHOULD use NTP or equivalent to ensure consistent token expiration validation.

### 5.5 Denial of Service
Scope negotiation adds handshake overhead. Implement circuit breakers and rate limiting on negotiation endpoints.

---

## 6. References

* [RFC2119] Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.
* [RFC6749] Hardt, D., "The OAuth 2.0 Authorization Framework", RFC 6749, October 2012.
* [RFC6750] Jones, M. and D. Hardt, "The OAuth 2.0 Authorization Framework: Bearer Token Usage", RFC 6750, October 2012.
* [RFC7662] Richer, J., "OAuth 2.0 Token Introspection", RFC 7662, October 2015.
* [RFC8174] Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017.
* [gRPC] gRPC Authors, "gRPC - A high performance, open-source universal RPC framework", https://grpc.io
* [CB] Nygard, M., "Release It! Design and Deploy Production-Ready Software", Pragmatic Bookshelf, 2018.

---

**Document drafted using Nemotron Super (120B) via GX-10**  
**Agentcy.services — 2026-04-10**
