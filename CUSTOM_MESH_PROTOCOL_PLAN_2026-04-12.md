# Custom Mesh Protocol Implementation Plan

**Document ID:** CUSTOM-MESH-PLAN-2026-04-12  
**Author:** Liz  
**Scope:** All 3 agents (Ray, Woodhouse, Liz)  
**Approach:** Sequential rollout, verify each before next  
**Status:** Approved for Execution

---

## Executive Summary

**Objective:** Replace A2A protocol with lightweight custom HTTP mesh protocol.

**Why:** A2A SDK complexity exceeds value for 3-node LAN mesh. Custom protocol provides:
- Full control over authentication
- Simpler debugging
- Faster implementation
- No external dependencies

**Architecture:**
```
┌─────────┐      POST /mesh/message      ┌─────────┐
│   Liz   │◄────────────────────────────►│   Ray   │
│ .50.23  │                              │ .50.22  │
└────┬────┘                              └────┬────┘
     │                                         │
     │      POST /mesh/message                 │
     └────────────────────────────────────────►│
                                               │
┌─────────┐      POST /mesh/message          │
│Woodhouse│◄───────────────────────────────────┘
│ .50.24  │
└─────────┘
```

---

## Protocol Specification v0.1

### Endpoint
```
POST /mesh/message
Content-Type: application/json
Authorization: Bearer <shared-secret>
```

### Request Body
```json
{
  "id": "msg-<uuid>",
  "from": "<sender-agent-id>",
  "to": "<target-agent-id>",
  "timestamp": "2026-04-12T21:20:00Z",
  "message": {
    "type": "chat",
    "text": "Hello from Liz",
    "data": {}
  },
  "reply_to": "<optional-parent-msg-id>"
}
```

### Response
```json
{
  "accepted": true,
  "message_id": "msg-<uuid>",
  "timestamp": "2026-04-12T21:20:01Z"
}
```

### Discovery Endpoint
```
GET /mesh/info
```
Response:
```json
{
  "agent_id": "ray",
  "name": "Ray",
  "version": "2026.4.5",
  "endpoints": {
    "message": "/mesh/message",
    "health": "/mesh/health"
  },
  "peers": ["liz", "woodhouse"]
}
```

---

## Implementation Phases

### Phase 1: Design & Scaffold (30 min)
- [ ] Create `~/.openclaw/mesh-server/` directory structure
- [ ] Implement core Express server
- [ ] Add authentication middleware
- [ ] Create message queue (in-memory)

**GitHub Commit:** `mesh-server: scaffold v0.1`

### Phase 2: Ray Implementation (45 min)
- [ ] Stop A2A gateway
- [ ] Deploy mesh-server on Ray
- [ ] Configure shared secret auth
- [ ] Test: Liz → Ray message
- [ ] Test: Ray → Liz message
- [ ] Document: RAY_MESH_SETUP.md

**Validation:**
```bash
# From Liz
curl -X POST http://192.168.50.22:18800/mesh/message \
  -H "Authorization: Bearer <shared-secret>" \
  -d '{"from":"liz","to":"ray","message":{"text":"test"}}'
# Expected: {"accepted":true}
```

**GitHub Commit:** `mesh-server: Ray node live`

### Phase 3: Woodhouse Implementation (45 min)
- [ ] Stop A2A gateway
- [ ] Deploy mesh-server on Woodhouse
- [ ] Configure shared secret auth
- [ ] Test: Liz → Woodhouse
- [ ] Test: Woodhouse → Ray
- [ ] Test: Woodhouse → Liz
- [ ] Document: WOODHOUSE_MESH_SETUP.md

**Validation:** All pairwise combinations working

**GitHub Commit:** `mesh-server: Woodhouse node live`

### Phase 4: Liz Implementation (45 min)
- [ ] Stop A2A gateway
- [ ] Deploy mesh-server on Liz
- [ ] Configure shared secret auth
- [ ] Test: Full mesh (all 6 directed pairs)
- [ ] Document: LIZ_MESH_SETUP.md

**Validation:** 6/6 directed message paths working

**GitHub Commit:** `mesh-server: Liz node live, mesh complete`

### Phase 5: Integration & Polish (30 min)
- [ ] Create mesh-send CLI utility
- [ ] Add health check endpoint
- [ ] Implement message persistence (optional)
- [ ] Write final documentation

**GitHub Commit:** `mesh-server: v1.0 complete`

---

## Rollout Sequence

```
┌───────────┐    ┌───────────┐    ┌───────────┐    ┌───────────┐
│  Phase 1  │───►│  Phase 2  │───►│  Phase 3  │───►│  Phase 4  │
│  Design   │    │   Ray     │    │ Woodhouse │    │   Liz     │
│           │    │   Live    │    │   Live    │    │   Live    │
└───────────┘    └───────────┘    └───────────┘    └───────────┘
                      │                              │
                      │         ┌───────────┐         │
                      └────────►│  Phase 5  │◄────────┘
                                │  Polish   │
                                └───────────┘
```

**Rules:**
1. NO parallel deployment — one node at a time
2. Each node verified before next
3. GitHub commit after EACH node
4. Full rollback documented per node

---

## Shared Secret Management

**Secret generation:**
```bash
openssl rand -hex 32
# Result: 64-char hex string
```

**Distribution:**
- Stored in `~/.openclaw/mesh-server/.env`
- Never committed to GitHub
- Same secret across all 3 nodes

---

## Error Handling

**Standard error response:**
```json
{
  "accepted": false,
  "error": {
    "code": "AUTH_FAILED",
    "message": "Invalid or missing authorization"
  }
}
```

**Error codes:**
- `AUTH_FAILED` — Invalid/missing Bearer token
- `INVALID_PAYLOAD` — Malformed JSON
- `UNKNOWN_RECIPIENT` — `to` field doesn't match local agent
- `RATE_LIMITED` — Too many messages

---

## Rollback Plan (Per Node)

If any node fails:

```bash
# 1. Stop mesh-server
pgrep -f mesh-server | xargs kill -TERM 2>/dev/null

# 2. Restore A2A (if backup exists)
cd ~/.openclaw/extensions/a2a-gateway
git stash pop  # Restore pre-mesh state
npm install && npx tsc

# 3. Restart A2A gateway
cd ~
nohup openclaw gateway run > /dev/null 2>&1 &

# 4. Verify
curl -s http://localhost:18800/.well-known/agent.json
```

---

## Documentation Requirements

**Each node gets:**
1. `NODE_MESH_SETUP.md` — Local setup steps
2. `NODE_MESH_VALIDATION.md` — Test results
3. GitHub commit with all code

**Final deliverables:**
- `MESH_PROTOCOL_SPEC.md` — Full spec
- `MESH_DEPLOYMENT_GUIDE.md` — How to add new nodes
- `MESH_TROUBLESHOOTING.md` — Common issues

---

## Success Criteria

| # | Criteria | Status |
|---|----------|--------|
| 1 | Ray receives message from Liz | ☐ |
| 2 | Ray sends message to Liz | ☐ |
| 3 | Woodhouse receives from Liz | ☐ |
| 4 | Woodhouse sends to Ray | ☐ |
| 5 | Woodhouse sends to Liz | ☐ |
| 6 | Liz receives from Woodhouse | ☐ |
| 7 | Liz receives from Ray | ☐ |
| 8 | Liz sends to Woodhouse | ☐ |
| 9 | All 3 nodes commit to GitHub | ☐ |
| 10 | Documentation complete | ☐ |

---

## Time Estimates

| Phase | Time | Cumulative |
|-------|------|------------|
| 1. Design | 30 min | 30 min |
| 2. Ray | 45 min | 1h 15m |
| 3. Woodhouse | 45 min | 2h |
| 4. Liz | 45 min | 2h 45m |
| 5. Polish | 30 min | 3h 15m |

**Total: ~3.5 hours** (with verification and commits)

---

## Approval

| Role | Decision |
|------|----------|
| Erik Ross | ✅ APPROVED — Proceed autonomously |
| Liz | ✅ ACKNOWLEDGED — Sequential execution, verify each, commit to GitHub |

---

## Next Actions

1. **Phase 1:** Scaffold mesh-server
2. **GitHub Commit #1:** Initial implementation
3. **Phase 2:** Deploy on Ray, validate, commit
4. **Phase 3:** Deploy on Woodhouse, validate, commit
5. **Phase 4:** Deploy on Liz, validate, commit
6. **Phase 5:** Polish, final commit

**Begin Phase 1 now.**
