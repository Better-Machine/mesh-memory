# Palace / Kingdom — Quick Reference

## What It Is

Palace (also called Kingdom) is a three-layer memory architecture for OpenClaw agents: L0 (identity), L1 (critical facts), and L2 (deep memory). It enables portable agent identity across hardware transitions and enforces a strict separation between facts (tunnel-safe) and interpretations (private to each agent).

---

## Architecture (L0-L2)

| Layer | What | File/Module |
|-------|------|-------------|
| L0 | **Agent Identity** — portable passport with agent metadata, capabilities, and hardware profile. Always loaded at wake-up (~400 tokens). | `palace-mvp/agent-passport.json` |
| L1 | **Critical Facts** — always-loaded facts from SQLite (decisions, events, configs, observations). Wake-up context only (~500 tokens). | `critical-facts-loader.mjs` |
| L2 | **Deep Memory** — searchable long-term facts, retrieved on demand via FTS5. Not loaded by default; queried per-task. | `critical-facts-loader.mjs` (searchDeepFacts) |

---

## Quick Start

```javascript
// Load palace context (L0 + L1)
const { loadPalaceContext } = await import('./a2a-palace-adapter.mjs');
const ctx = await loadPalaceContext();

// ctx.passport — agent identity (L0)
// ctx.facts — critical facts array (L1)
// ctx.tokenEstimate — total token count
```

---

## Files Reference

| File | Purpose |
|------|---------|
| `agent-passport.json` | L0 identity layer. Portable across machines. Contains agent ID, capabilities, hardware profile, mesh identity. |
| `critical-facts-loader.mjs` | L1/L2 SQLite loader. Manages critical_facts table with FTS5 indexing. Provides wake-up context generation. |
| `tunnel-publisher.mjs` | Cross-agent fact publishing. Validates facts vs interpretations. Handles retry queue and provenance checks. |
| `a2a-palace-adapter.mjs` | A2A protocol bridge. Loads palace context for sessions and publishes facts to peers. |

---

## Tests

```bash
# Run all test suites
node tests/a2a-palace-adapter.test.mjs    # 8 tests — context loading, publishing, validation
node tests/tunnel-publisher.test.mjs       # 10 tests — validation, provenance, retries

# Note: critical-facts-loader tests are integrated into the loader module
# Run via: node critical-facts-loader.mjs --test (if supported) or import in test harness
```

---

## Design Docs

- **`palace-mvp/TUNNEL_PROTOCOL.md`** — Fact/interpretation separation rules. Defines what CAN traverse tunnels (decisions, events, dates, configs, observations) and what CANNOT (assessments, opinions, predictions, emotional readings).
- **`docs/decisions/ADR-0003-palace-kingdom-architecture.md`** — Architecture decision record. Explains L0-L2 layering rationale, fact/interpretation separation, and why SQLite was chosen over MemPalace for MVP.

---

## Next Steps

| Phase | Task | Status |
|-------|------|--------|
| P6 | **Shared Memory (L2)** — Full deep memory search integration, cross-agent L2 queries | 🔲 Planned |
| P7 | **Dream Cycle Integration** — Nightly consolidation of L2 facts into L1 critical tier | 🔲 Planned |
| P8 | **Multi-Node Test** — End-to-end tunnel testing across Liz, Ray, Woodhouse nodes | 🔲 Planned |

---

## Core Principles

1. **Facts traverse tunnels; interpretations stay private.** Prevents bias laundering across agents.
2. **Wake-up context < 900 tokens.** L0 + L1 loaded always; L2 queried on demand.
3. **Portable identity.** Passport moves with agent across hardware (GX-10, Mac Studio, cloud).
4. **Provenance required.** Every tunneled fact includes source, timestamp, and optional signature.

---

*Document version: 1.0.0*  
*Last updated: 2026-04-12*
