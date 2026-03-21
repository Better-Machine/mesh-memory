# mesh-memory Architecture

## Design Philosophy

Two layers. One always on. One only when needed.

---

## Layer 1: Session Cohesion (Primary)

Every agent maintains its own deep, continuous memory across sessions. This is the foundation — not a feature.

```
Session JSONL
    ↓
LCM (lossless-claw)       — raw message database, summaries with expand capability
    ↓
QMD (quick-memory-distill) — surgical retrieval, indexes MEMORY.md + memory/*.md
    ↓
memory/YYYY-MM-DD.md       — daily notes: raw events, decisions, context
memory/mesh/lessons/       — tagged lessons, corrections, mistakes (cross-session)
MEMORY.md                  — curated long-term memory: the distilled essence
    ↓
dream-cycle (nightly)      — consolidates recent summaries → MEMORY.md suggestions
                             (human-approved, never auto-modifies)
```

Each agent's memory is:
- **Private by default** — not shared with peer agents unless a thread is opened
- **Deep** — LCM preserves every message with full expandability
- **Surgical** — QMD retrieves only what's relevant, not entire files
- **Durable** — daily files and MEMORY.md survive gateway restarts and version upgrades

### Privacy filter (session cohesion feature)

Messages can be marked private to suppress them from ever leaving the agent:

- Per-message: include the word `private` anywhere in the message
- Session block: `[private]` opens a private zone, `[/private]` closes it
- Keyword config: define sensitive keywords in `mesh-memory.config.local.json`

See `privacy.mjs` for implementation.

### Lesson tagging (session cohesion feature)

Agents and users can tag messages for priority treatment in the dream-cycle:

| Tag | Meaning |
|-----|---------|
| `[lesson]` | Insight or principle worth keeping |
| `[correction]` | Corrects a prior error |
| `[mistake]` | Agent-acknowledged error — own it, tag it |
| `[decision]` | Deliberate choice + rationale |
| `[warning]` | Known risk or gotcha |

Tagged messages are written to `memory/mesh/lessons/YYYY-MM-DD.md` and indexed by QMD.
See `lesson-tagger.mjs` for implementation.

---

## Layer 2: Collaboration Mesh (Secondary — Ephemeral, Consent-Gated)

When a task genuinely benefits from multi-agent collaboration, agents can open a **mesh thread** — a bounded, purpose-scoped shared context that lives only as long as the work requires.

### Core principles

- **Ephemeral** — threads have a defined purpose and a close condition
- **Consent-gated** — no agent joins without explicitly agreeing; no thread opens without user approval
- **Purpose-scoped** — only content relevant to the stated purpose is shared
- **Non-polluting** — thread content does not bleed into individual agent memory unless deliberately archived
- **User-gated** — the user is the final approver; agents negotiate among themselves first

### Thread lifecycle

```
1. PROPOSAL
   Agent A detects that a task would benefit from collaboration.
   A proposes a thread via A2A to relevant peers:
     - Purpose (one sentence)
     - Scope (what will be shared)
     - Participating agents
     - Expected duration or close condition

2. AGENT CONSENT
   Each peer evaluates the proposal and responds: accept / decline / counteroffer.
   If any agent declines, Agent A either revises the proposal or proceeds without them.
   Agents negotiate among themselves — user is not involved at this stage.

3. USER NOTIFICATION
   Once all agents have reached consensus, the user receives a single notification:
     "Ray and I want to open a collaboration thread. Here's why, here's the scope,
      here's who's involved, here's when it ends. Approve?"
   The user sees a complete picture — not a work-in-progress negotiation.

4. USER APPROVAL
   User approves or declines.
   Approval is the final gate — no thread opens without it.

5. THREAD OPEN
   A shared context file is created: memory/threads/<thread-id>/context.md
   Scoped ephemeral tokens are issued to participating agents.
   Agents begin writing to shared context.

6. WORK HAPPENS
   Agents read and write to the thread context.
   Privacy filter still applies within threads.
   All participants see the same context.

7. THREAD CLOSE
   Triggered by: close condition met, all agents agree to close,
   user requests close, or timeout.
   Optional: thread summary distilled to individual agent MEMORY.md
   (requires separate per-agent approval).
   Thread context archived. Tokens invalidated.
```

### What gets shared in a thread

Only what the stated scope covers. A thread scoped to "coordinate the clean-sl8 iOS app plan" shares:
- Messages explicitly written to the thread context
- Decisions and lessons tagged for the thread

What it does NOT share:
- The agents' individual session memory
- Messages from other ongoing conversations
- Anything marked private

### When agents should propose a thread

A thread is warranted when:
- Two or more agents are working on the same deliverable and need to avoid conflicts
- One agent has context another agent critically needs to do their job
- A handoff is happening and the receiving agent needs live context, not a static file
- A decision needs genuine input from multiple agents before reaching the user

A thread is NOT warranted for:
- Routine status updates (use A2A point messages)
- Information that can be captured in a handoffs/ file
- Anything one agent can handle independently
- Curiosity or "it might be useful"

---

## Component Map

```
mesh-memory/
│
├── Session Cohesion Layer
│   ├── memory-bridge.mjs      — polls LCM SQLite → memory/lcm/YYYY-MM-DD.md
│   ├── dream-cycle.mjs        — nightly consolidation → MEMORY.md suggestions
│   ├── privacy.mjs            — privacy filter (per-message, session block, keywords)
│   └── lesson-tagger.mjs      — tag detection and lessons file writer
│
├── Collaboration Mesh Layer (v2 — built)
│   ├── thread-propose.mjs     — standalone HTTP proposal to peers
│   ├── thread-consent.mjs     — agent consent handler (auto-accept placeholder)
│   ├── thread-notify.mjs      — user notification after agent consensus
│   ├── thread-context.mjs     — shared context read/write with ephemeral tokens
│   ├── thread-close.mjs       — cleanup, archival, token revocation
│   └── thread-manager.mjs     — orchestrator, port 18802, timeout checker
│
├── Infrastructure (v1 — relay pipeline, deprioritized)
│   ├── memory-watcher.mjs     — fs.watch on session JSONL (relay trigger)
│   ├── memory-relay.mjs       — A2A HTTP relay to peers
│   └── memory-receiver.mjs    — Express receiver, writes to memory/mesh/
│
├── Setup & Config
│   ├── setup.mjs              — bootstraps token exchange via coordination repo
│   ├── config.mjs             — config loader
│   └── mesh-memory.config.json — example config
│
└── Documentation
    ├── ARCHITECTURE.md        — this file
    ├── AGENT_GUIDELINES.md    — operating instructions for mesh agents
    ├── DEPLOY.md              — deployment guide
    └── STRESS_TEST_PLAN.md    — test scenarios
```

---

## What's Built vs What's Designed

| Component | Status |
|-----------|--------|
| LCM integration (memory-bridge) | ✅ Built |
| Dream cycle | ✅ Built |
| Privacy filter | ✅ Built |
| Lesson tagging | ✅ Built |
| Agent guidelines | ✅ Written |
| Setup / token exchange | ✅ Built |
| Always-on relay pipeline | ✅ Built (deprioritized) |
| Thread proposal (standalone HTTP) | ✅ Built |
| Thread consent handler | ✅ Built |
| User notification gate | ✅ Built |
| Shared thread context | ✅ Built |
| Thread close + archival | ✅ Built |
| Thread manager (orchestrator) | ✅ Built |
| Token expiry / rotation | 🔲 Not yet built |
| Queue persistence + replay | 🔲 Not yet built |
| Storage rotation / pruning | 🔲 Not yet built |

---

## Design Decisions Log

**2026-03-21 — Relay pipeline deprioritized**
The always-on relay (watcher → relay → receiver) was built first but creates sycophancy risk: agents sharing all context converge on one perspective, eroding the independence that makes multi-agent systems valuable. Session cohesion for each agent is the primary value. The relay pipeline is retained in the codebase but is not the recommended deployment path.

**2026-03-21 — Consent-gated thread model adopted**
Agents negotiate collaboration among themselves first, then present a single consent request to the user. This avoids involving the user in internal agent negotiation while preserving user authority as the final gate. Thread scope is defined at proposal time and does not expand without a new consent cycle.
