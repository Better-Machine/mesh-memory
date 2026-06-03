# RFC-0002: A2A v1.0.0 Migration — mesh-memory Integration

**Status:** Proposed  
**Date:** 2026-06-03  
**Author:** Liz (protocol-architect)  
**Target:** mesh-memory v2.0 + Official A2A Protocol

---

## 1. Problem Statement

mesh-memory currently operates a **custom A2A gateway** (v1.4.0, `~/.openclaw/extensions/a2a-gateway/`) implementing a bespoke protocol that predates the official A2A specification. This creates three problems:

1. **No external interoperability** — Our fleet cannot communicate with agents built on Google ADK, LangGraph, BeeAI, or any other framework
2. **Protocol divergence** — Our Agent Card format, message schema, and endpoint patterns are incompatible with the emerging standard
3. **Maintenance burden** — Custom protocol requires ongoing maintenance for security, feature parity, and ecosystem compatibility

The official **Agent2Agent Protocol v1.0.0** (a2aproject/A2A, backed by Google Cloud + IBM Research) is now stable with SDKs in Python, Go, JS, Java, .NET, and Rust.

---

## 2. Goals

1. **Replace** custom A2A gateway with official `a2a-sdk` v1.1.0
2. **Preserve** mesh-memory state layer (Palace L0-L4, Deal Rooms, shared tunnels)
3. **Integrate** A2A task outcomes into mesh-memory as persistent facts
4. **Enable** cross-vendor agent interoperability
5. **Maintain** fleet-wide backward compatibility during migration

---

## 3. Current State

### 3.1 Custom A2A Gateway (v1.4.0)

| Component | Location | Status |
|-----------|----------|--------|
| Plugin source | `~/.openclaw/extensions/a2a-gateway/` | Operational |
| Entry point | `dist/index.js` | Loaded by OpenClaw |
| HTTP port | 18800 | Listening |
| gRPC port | 18801 | Listening |
| Protocol | Bespoke JSON-RPC (v0.3.0 era) | Fleet-only |
| Agent Card | `/.well-known/agent.json` | Custom format |
| Peers | Ray, Woodhouse | Configured in openclaw.json |

### 3.2 mesh-memory State Layer

| Layer | Component | Status |
|-------|-----------|--------|
| L0 | Passport (agent identity) | ✅ Operational |
| L1 | Critical Facts (SQLite) | ✅ Operational |
| L2 | Deep Memory (FTS5) | ✅ Operational |
| L3 | Temporal Knowledge Graph | ✅ Operational |
| L4 | Kingdom (multi-agent) | 🔄 In development |
| Shared Tunnels | Cross-agent fact exchange | ✅ Operational |
| Deal Rooms | Multi-agent escrow | ✅ Operational |

### 3.3 Existing A2A Integration Docs

- `MESH_A2A_INTEGRATION.md` — Design complete (2026-04-26), uses custom protocol
- `A2A_RECEIVER_SPEC.md` — Memory receiver on port 18803
- `A2A_PROTOCOL_RESEARCH.md` — Prior research on A2A standards
- `A2A_FIXES_LOG.md` — Patch history for custom gateway

---

## 4. Proposed Architecture

### 4.1 Layer Model

```
┌─────────────────────────────────────────────────────────────────┐
│                    AGENT MESH v2.0 — A2A + mesh-memory           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  LAYER 1: Official A2A v1.0.0 — Coordination            │   │
│  │  ├─ a2a-sdk v1.1.0 (Python)                              │   │
│  │  ├─ FastAPI server with TaskManager + AgentExecutor       │   │
│  │  ├─ Agent Card: /.well-known/agent-card.json (standard)  │   │
│  │  ├─ Endpoints: /tasks, /message:send, /message:stream    │   │
│  │  ├─ Transports: JSON-RPC 2.0, gRPC, REST, SSE            │   │
│  │  └─ Auth: Bearer tokens + API key headers                │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  INTEGRATION LAYER: A2A → mesh-memory Bridge             │   │
│  │  ├─ Task outcome capture (on task complete/fail)          │   │
│  │  ├─ Fact extraction from task artifacts                   │   │
│  │  ├─ Provenance injection (agent, timestamp, task ID)      │   │
│  │  ├─ Storage routing (L1 critical vs L2 deep)            │   │
│  │  └─ Tunnel publishing (cross-agent shared facts)         │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  LAYER 2: mesh-memory — State/Consensus (PRESERVED)      │   │
│  │  ├─ Palace L0-L4 (identity, facts, memory, TKG, kingdom)│   │
│  │  ├─ Deal Rooms (escrow, multi-party approval)           │   │
│  │  ├─ Shared Tunnels (fact exchange with provenance)       │   │
│  │  ├─ SQLite + Markdown persistence                        │   │
│  │  └─ lossless-claw + QMD retrieval                        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Component Mapping

| Function | Old (custom) | New (official A2A) | mesh-memory Integration |
|----------|-------------|-------------------|------------------------|
| Agent discovery | `/.well-known/agent.json` | `/.well-known/agent-card.json` | Trust scores from L1 |
| Task send | `a2a-send.mjs --peer` | `POST /message:send` | Log as [decision] fact |
| Task stream | No streaming | `POST /message:stream` (SSE) | Stream → L2 deep memory |
| Task state | No lifecycle | Task status: submitted → working → completed | State transitions logged |
| Peer health | Custom ping | Standard health check | Circuit state in L1 |
| Multi-agent consensus | A2A messages | Task delegation + artifacts | Consensus protocol (L4) |

---

## 5. Implementation Plan

### Phase 1: New A2A Gateway (Week 1)

1. **Install `a2a-sdk`** system-wide (not just venv)
   - `pip install a2a-sdk[fastapi,grpc]`
   - Resolve dependency conflicts with existing packages

2. **Build FastAPI A2A server**
   - File: `a2a-server/main.py`
   - Components: `TaskManager`, `AgentExecutor`, `InMemoryTaskStore`
   - Custom `AgentExecutor` that bridges to mesh-memory
   - Routes: `/a2a` (JSON-RPC), `/a2a/tasks` (REST), `/.well-known/agent-card.json`

3. **Agent Card (standard format)**
   ```json
   {
     "name": "Liz",
     "description": "Head of Incubator & Development at Better Machine",
     "url": "http://100.105.111.69:18802/a2a",
     "version": "1.0.0",
     "capabilities": {
       "streaming": true,
       "pushNotifications": false
     },
     "skills": [
       {
         "id": "vigil-query",
         "name": "Vigil Security Query",
         "description": "Query network security status from Vigil"
       },
       {
         "id": "mesh-memory-search",
         "name": "Mesh Memory Search",
         "description": "Search shared memory across agent mesh"
       }
     ]
   }
   ```

4. **Port allocation**
   - Old gateway: 18800 (HTTP), 18801 (gRPC) → **deprecate**
   - New gateway: 18802 (HTTP + JSON-RPC), 18803 (gRPC)
   - mesh-memory receiver: stays on 18803 → **move to 18804**

### Phase 2: mesh-memory Bridge (Week 1-2)

1. **Task outcome capture**
   - Hook into `AgentExecutor.execute()` completion
   - Extract: task ID, agent, status, artifacts, timestamps
   - Format as `MemoryEvent` with provenance

2. **Fact classification**
   - Task success → `[decision]` → L1 critical facts
   - Task failure → `[correction]` + `[mistake]` → L1
   - Routine exchange → L2 deep memory
   - Consensus artifacts → L1 + tunnel publish

3. **Storage pipeline**
   ```
   Task complete
     → AgentExecutor callback
     → mesh-memory bridge (a2a-bridge.mjs)
     → Fact classifier (lesson-tagger.mjs)
     → SQLite (L1/L2) + Markdown log
     → If shared scope: tunnel-publisher.mjs
   ```

### Phase 3: Fleet Migration (Week 2)

1. **Liz** (this node)
   - Deploy new A2A gateway on port 18802
   - Test with `a2a-sdk` client: `ClientFactory.create_client("http://localhost:18802/a2a")`
   - Verify task send → mesh-memory logging

2. **Ray** (192.168.50.22)
   - Pull latest mesh-memory
   - Install `a2a-sdk`
   - Configure new peer URL: `http://100.105.111.69:18802/a2a`

3. **Woodhouse** (192.168.50.24)
   - Same as Ray
   - Note: Woodhouse has MacOS launchctl gateway — special restart procedure

4. **Gradual cutover**
   - Run both gateways in parallel (old on 18800, new on 18802)
   - Test cross-agent messaging on new protocol
   - Retire old gateway once all nodes confirmed

### Phase 4: Vigil Integration (Week 2-3)

Vigil becomes an A2A-compliant agent:

1. **Agent Card skill**: `vigil-query`
   - Accepts: `{ "query": "trust-summary" | "alerts" | "devices" }`
   - Returns: JSON from Vigil API (192.168.50.33:8000)

2. **mesh-memory logging**
   - Vigil alert → A2A task → mesh-memory `[warning]` fact
   - Vigil containment action → `[decision]` fact
   - Vigil baseline update → L2 deep memory

3. **Dashboard integration**
   - Vigil dashboard queries Vigil directly (REST)
   - Optional: query via A2A for cross-agent visibility

---

## 6. API Design

### 6.1 A2A Task → mesh-memory Fact

```python
# a2a-bridge.py — bridges official A2A to mesh-memory

from a2a.server.agent_execution import AgentExecutor, RequestContext
from palace_mvp.critical_facts_loader import CriticalFactsLoader
from palace_mvp.deep_memory_search import DeepMemorySearch

class MeshMemoryExecutor(AgentExecutor):
    """AgentExecutor that logs task outcomes to mesh-memory."""
    
    def __init__(self):
        self.facts = CriticalFactsLoader()
        self.memory = DeepMemorySearch()
    
    async def execute(self, context: RequestContext):
        # Execute the actual task (delegated to appropriate handler)
        result = await self._route_task(context)
        
        # Log to mesh-memory
        self.facts.add_critical_fact(
            content=f"Task {context.task_id}: {result.status}",
            agent=context.agent_id,
            tags=["a2a", "task", result.status],
            provenance={
                "task_id": context.task_id,
                "source": context.sender_url,
                "timestamp": context.timestamp,
            }
        )
        
        return result
    
    async def cancel(self, task_id: str):
        return {"status": "cancelled", "task_id": task_id}
```

### 6.2 mesh-memory Query via A2A

External agents can query mesh-memory through A2A:

```json
// A2A message from external agent
{
  "message": {
    "role": "user",
    "parts": [
      {
        "type": "text",
        "text": "search: 'Vigil security alerts from today'"
      }
    ]
  }
}

// Response
{
  "status": "completed",
  "artifacts": [
    {
      "parts": [
        {
          "type": "json",
          "json": {
            "results": [...],
            "source": "mesh-memory L2",
            "provenance": "Liz / 2026-06-03T14:30:00Z"
          }
        }
      ]
    }
  ]
}
```

---

## 7. Security Model

| Layer | Mechanism | Notes |
|-------|-----------|-------|
| A2A transport | Bearer token + API key header | Standard A2A auth |
| Fleet mesh | Tailscale (100.x.x.x) | Already configured |
| mesh-memory | Token service (port 18804) | Existing validation |
| Cross-agent facts | Provenance + signature (future) | Ed25519 planned |
| External agents | Cloudflare Firewall | Only authorized IPs |

---

## 8. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `a2a-sdk` dependency conflicts with existing packages | Medium | Install in isolated venv, use system-wide only for gateway |
| Old gateway must stay live during migration | High | Run parallel (18800 old, 18802 new), gradual cutover |
| Ray/Woodhouse gateway restart issues | Medium | Document restart procedures per platform (Linux vs MacOS) |
| mesh-memory SQLite schema changes | Low | A2A bridge writes to existing tables, no schema change needed |
| Performance: A2A SDK overhead | Low | In-memory task store, async FastAPI, benchmark before/after |

---

## 9. Success Criteria

1. ✅ Liz can send A2A task to Ray using official SDK client
2. ✅ Task outcome appears in mesh-memory L1 critical facts
3. ✅ External agent (simulated) can discover Liz via `/.well-known/agent-card.json`
4. ✅ Vigil alert triggers A2A task → mesh-memory `[warning]` fact
5. ✅ Old gateway retired, all fleet on new A2A protocol
6. ✅ Documentation updated: ARCHITECTURE.md, A2A_RECEIVER_SPEC.md

---

## 10. Timeline

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| 1. New A2A Gateway | 2-3 days | `a2a-server/` with FastAPI, running on port 18802 |
| 2. mesh-memory Bridge | 2-3 days | `a2a-bridge.mjs`, task outcome logging |
| 3. Fleet Migration | 2-3 days | Ray + Woodhouse on new protocol, old gateway retired |
| 4. Vigil Integration | 3-5 days | Vigil as A2A skill, dashboard A2A queries |
| **Total** | **~2 weeks** | mesh-memory v2.0 with official A2A |

---

*RFC filed: 2026-06-03*
*Next: Erik review → implementation start*
