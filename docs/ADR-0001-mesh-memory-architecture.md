# ADR-0001: Mesh-Memory Architecture

**Status:** Accepted  
**Date:** 2026-04-25  
**Author:** Liz (Better Machine)  
**Reviewers:** Erik Ross  

## Context

The Agentcy.services mesh needed a cross-session memory system that:
1. Survives agent restarts and hardware transitions
2. Maintains privacy boundaries (facts ≠ interpretations)
3. Supports collaboration without centralization
4. Operates at production scale (99.9% uptime)

## Decision

We will implement a **three-tier memory architecture**:

```
┌─────────────────────────────────────────────────────────────┐
│                      L0: Identity                            │
│              (Who am I? - Portable Passport)                │
├─────────────────────────────────────────────────────────────┤
│                      L1: Critical Facts                      │
│         (Always loaded: projects, preferences)              │
├─────────────────────────────────────────────────────────────┤
│               L2+: Deep Memory (On-Demand)                  │
│    (Searchable: full history, archived sessions)            │
└─────────────────────────────────────────────────────────────┘
```

### Key Patterns

1. **Sovereign Identity**: Each agent owns their palace; no shared group memory
2. **Tunnels, Not Wings**: Cross-agent facts flow through narrow, explicit channels
3. **Fact/Interpretation Separation**: Shared pool = facts only; interpretations = private by default
4. **Tiered Loading**: L0-L1 (~500 tokens) always loaded; L2+ searched on demand

## Consequences

### Positive
- Privacy-preserving by architecture (not just policy)
- Portable across hardware/platforms
- Scalable (no single shared memory bottleneck)
- Compatible with OpenClaw's session model

### Negative
- Requires explicit consent for cross-agent tunneling
- More complex than single shared database
- Agents must negotiate shared context

## Alternatives Considered

| Approach | Rejected Because |
|----------|------------------|
| Single shared DB | Centralization risk, privacy leakage |
| MemPalace wholesale | Too complex for MVP; over-engineered |
| Filesystem only | No search, no durability guarantees |

## References

- mesh-memory P1-P5 MVP spec
- BIAS_PROPAGATION_RESEARCH.md
- MemPalace analysis (external research)

---

*Part of the mesh-memory production release v1.0.0*
