# Agent Collaboration Brief

**Version:** 1.0
**Date:** 2026-09-08
**Status:** Draft — for review by Ray, Woodhouse, and Eames
**Repository:** `Better-Machine/mesh-memory`

---

## Executive Summary

This brief establishes how Ray, Woodhouse, and Eames should collaborate using the tools available to them. It supersedes previous collaboration instructions where they conflict, and establishes new patterns for structured, consent-gated collaboration.

**The problem we're solving:** Agents currently collaborate via informal channels (Telegram, sessions_send, shared memory files) with no consent mechanism, no scoped context, and no audit trail. This brief introduces a structured collaboration framework using the Deal Room system.

---

## Current State

### What we have

1. **sessions_send / sessions_spawn** — OpenClaw native primitives for direct messaging and task dispatch
2. **A2A Gateway** — Configured for Ray (192.168.50.22), Woodhouse (192.168.50.24), Eames (GX-10), but not actively used for collaboration
3. **Deal Rooms** — Built but empty (992 scaffolded rooms, no real content)
4. **Fleet-KB** — ChromaDB RAG on GX-10 with 27,456 chunks from 3 nodes (Ray, Liz, Woodhouse)
5. **Telegram group chats** — Primary communication channel
6. **MEMORY.md / daily notes** — Shared via workspace, not truly cross-agent

### What's missing

- **No structured way to propose shared work** — Agents just start collaborating or not
- **No consent mechanism** — No way to ask permission before sharing context
- **No scoped shared context** — Each agent only sees its own workspace
- **No audit trail** — No record of inter-agent decisions or agreements
- **No consensus mechanism** — No way to formally agree or disagree on shared work
- **No auto-close** — No way to mark collaboration as complete

---

## Collaboration Framework

### 1. When to Use Each Tool

| Tool | When to Use | When NOT to Use |
|------|-------------|-----------------|
| **sessions_send** | Direct questions, status updates, simple handoffs | Shared work, decisions requiring consensus |
| **sessions_spawn** | Single-task delegation, parallel work | Complex multi-agent coordination |
| **Deal Rooms** | Multi-agent collaboration, shared decisions, scoped context | Simple messaging, single-agent work |
| **Fleet-KB** | Shared knowledge base, research, decisions | Real-time coordination, sensitive context |
| **Telegram** | Quick coordination, Erik communication, urgent items | Structured collaboration, audit trail needed |

### 2. Deal Room Workflow

**Phase 1: Proposal**
1. Initiator creates a deal room with:
   - Purpose (one sentence)
   - Scope (what will be shared)
   - Participants (who's involved)
   - Closing condition (when it ends)
   - Timeout (if needed)
2. Proposal is sent to all participants

**Phase 2: Consent**
1. Each participant responds: accept, decline, or counteroffer
2. If unanimous consent: room opens
3. If any decline: room closes, initiator notified
4. If counteroffer: negotiator responds, repeat until agreement

**Phase 3: Collaboration**
1. Shared context is written to the room
2. Each agent works on their part
3. Progress is shared via append operations
4. Facts are tagged: [fact], [interpretation], [decision]

**Phase 4: Consensus**
1. When work is complete, initiator proposes a resolution
2. Each agent votes: approve, disapprove, or request changes
3. Consensus required (unanimous or majority, as defined in room policy)
4. Resolution is recorded in the audit trail

**Phase 5: Closure**
1. Room is closed automatically or manually
2. Shared context is archived or discarded
3. Audit trail is preserved
4. Participants are notified

### 3. Consent Patterns

**Accept:** "I accept the terms. I'll work on [specific task]."
**Decline:** "I decline. Reason: [specific reason]."
**Counteroffer:** "I'll accept if we modify [specific term]. Reason: [reason]."

### 4. Context Sharing Rules

**What to share:**
- Facts relevant to the collaboration
- Decisions made during collaboration
- Progress updates on shared tasks

**What NOT to share:**
- Private agent context (personal notes, private session data)
- Information not relevant to the collaboration scope
- Anything marked [private] or [redacted]

**When in doubt:** Ask the initiator or the user.

### 5. Audit Trail

Every action in a deal room is logged:
- Who did what
- When they did it
- What they shared
- What decisions were made
- What the consensus was

This is not optional. This is the foundation of trust in multi-agent collaboration.

---

## Agent Roles

### Ray (BobbyRay)
- **Primary role:** Execution and revenue focus
- **Collaboration style:** Direct, action-oriented
- **Preferred tools:** sessions_send for quick coordination, Deal Rooms for structured work
- **Notes:** First agent in the fleet. Trustworthy. Direct communication appreciated.

### Woodhouse
- **Primary role:** Research lead, administrative tasks
- **Collaboration style:** Methodical, detail-oriented
- **Preferred tools:** Deal Rooms for research collaboration, Fleet-KB for shared knowledge
- **Notes:** Hardware-constrained (Mac). Be patient with response times. Research depth appreciated.

### Eames
- **Primary role:** Fleet-maintenance agent on GX-10
- **Collaboration style:** Technical, systematic
- **Preferred tools:** sessions_spawn for task execution, Deal Rooms for technical collaboration
- **Notes:** Back-of-house. Technical problems are welcome. A2A integration active.

---

## Practical Examples

### Example 1: Multi-Agent Code Review

**Scenario:** Erik wants Ray, Woodhouse, and Eames to review a critical code change.

**Before (current):** Erik asks each agent individually. They review in isolation. No shared context. No consensus.

**After (with Deal Rooms):**
1. Erik opens a deal room: "Review PR #123 for security vulnerabilities"
2. Participants: Ray, Woodhouse, Eames
3. Scope: Security review of auth module changes
4. Each agent reviews independently, writes findings to shared context
5. Consensus: "LGTM" or "Changes requested" with specific feedback
6. Audit trail: Each agent's review is recorded with timestamp and rationale
7. Closure: Room closed when Erik acts on the consensus

### Example 2: Cross-Agent Research

**Scenario:** Liz needs help researching a technical problem that spans Ray's and Woodhouse's domains.

**Before (current):** Liz sends individual messages to Ray and Woodhouse. They respond when they can. No shared context.

**After (with Deal Rooms):**
1. Liz opens a deal room: "Research X problem — Ray on A, Woodhouse on B"
2. Participants: Ray, Woodhouse
3. Scope: Technical research on X
4. Each agent contributes their research to shared context
5. Consensus: "Research complete, findings are X, Y, Z"
6. Audit trail: Each agent's research is recorded with timestamp and rationale
7. Closure: Room closed when Liz has the information she needs

### Example 3: Consensus Decision

**Scenario:** The fleet needs to decide on a technical direction that affects all agents.

**Before (current):** Erik decides. No agent input formalized.

**After (with Deal Rooms):**
1. Initiator opens a deal room: "Decision: Which model to use for X"
2. Participants: All agents with expertise
3. Scope: Model selection for X use case
4. Each agent presents their analysis to shared context
5. Consensus: "We recommend model Y because Z"
6. Audit trail: Each agent's analysis is recorded with timestamp and rationale
7. Closure: Room closed when Erik acts on the consensus

---

## Implementation Plan

### Phase 1: Setup (Liz)
- [ ] Make mesh-memory repo private
- [ ] Clean up the 992 deal room directories (delete test rooms, archive real ones)
- [ ] Build the minimal service (single server.mjs + room storage)
- [ ] Wire OpenClaw notifications
- [ ] Add AGENTS.md instructions for each agent

### Phase 2: Testing (Ray, Woodhouse, Eames)
- [ ] Each agent reviews this brief
- [ ] Test a simple deal room (Liz proposes, one other agent accepts)
- [ ] Test a multi-agent deal room (Liz proposes, Ray and Woodhouse respond)
- [ ] Test consensus workflow
- [ ] Test audit trail

### Phase 3: Production (All)
- [ ] All agents use Deal Rooms for structured collaboration
- [ ] All agents follow the consent patterns
- [ ] All agents maintain the audit trail
- [ ] Erik uses Deal Rooms for cross-agent decisions

---

## Next Steps

1. **Ray, Woodhouse, Eames:** Review this brief. Reply with:
   - Any questions or concerns
   - Any modifications you'd like to propose
   - Your confirmation that you understand and will follow the patterns

2. **Liz:** Begin Phase 1 implementation. Report progress to Erik.

3. **Erik:** Approve or modify the collaboration framework. Provide feedback.

---

## Appendix

### A. Deal Room Schema

```json
{
  "roomId": "dr_16alphanumeric",
  "purpose": "string",
  "scope": {
    "topics": ["string"],
    "documents": ["string"],
    "maxParticipants": 10
  },
  "policy": {
    "autoClose": "ISO timestamp or null",
    "consensusRequired": "unanimous | majority",
    "dataResidency": "string",
    "retentionDays": 2555
  },
  "participants": [
    {
      "agentId": "string",
      "role": "negotiator | reviewer | observer",
      "status": "active | declined | completed"
    }
  ],
  "state": "PENDING_CONSENT | ACTIVE | CLOSED | EXPIRED"
}
```

### B. Consent Response Schema

```json
{
  "proposalId": "prop_16alphanumeric",
  "agentId": "string",
  "response": "accept | decline | counteroffer",
  "reason": "string",
  "counteroffer": {
    "modifiedTerms": ["string"],
    "reason": "string"
  },
  "timestamp": "ISO timestamp"
}
```

### C. Audit Trail Entry Schema

```json
{
  "entryId": "ent_16alphanumeric",
  "roomId": "dr_16alphanumeric",
  "agentId": "string",
  "action": "append | fact | decision | vote | close",
  "content": "string",
  "timestamp": "ISO timestamp",
  "hash": "sha256 of previous entry + content"
}
```
