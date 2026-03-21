# mesh-memory

Cross-session memory and consent-gated collaboration for OpenClaw agents.

Built by Liz and Erik Ross · [Better Machine](https://bettermachine.ai)

---

## What it does

Two distinct layers:

### Layer 1 — Session Cohesion (always on)

Each agent maintains deep, private memory across sessions:

- **LCM bridge** — exports LCM summaries into searchable markdown
- **Dream cycle** — nightly consolidation of recent context into MEMORY.md (human-approved)
- **Privacy filter** — per-message and session-scoped suppression via `private` keyword or `[private]`/`[/private]` blocks
- **Lesson tagging** — `[lesson]` `[correction]` `[mistake]` `[decision]` `[warning]` tags route messages to a dedicated lessons log, prioritised by the dream cycle

This is the foundation. No relay, no cross-agent sharing by default. Each agent knows its own history deeply.

### Layer 2 — Collaboration Mesh (ephemeral, consent-gated)

When a task genuinely benefits from multi-agent collaboration, agents can open a **mesh thread**:

1. An agent detects a collaboration opportunity and proposes a thread via A2A
2. Peer agents evaluate and consent (or decline) independently
3. Once agents reach consensus, the **user receives a single notification** with full context
4. User approves → thread opens with a defined purpose, scope, and close condition
5. Agents collaborate in a shared bounded context
6. Thread closes → optional summary distilled to individual agent memory

No thread opens without user approval. No agent joins without consenting. No content bleeds outside the stated scope.

---

## Privacy

| Method | How |
|--------|-----|
| Per-message | Include `private` anywhere in your message |
| Session block | `[private]` opens, `[/private]` closes |
| Keyword config | Add words to `privacy.keywords` in config |

Suppressed messages are not relayed. A `[redacted]` notice is logged locally so agents know a gap exists.

---

## Lesson Tagging

Tag messages to create a persistent, searchable lessons log:

```
[lesson]     — insight or principle worth keeping
[correction] — corrects a prior error
[mistake]    — agent-acknowledged error (self-tagging is expected)
[decision]   — deliberate choice + rationale
[warning]    — known risk or gotcha
```

Tags can appear anywhere inline. Tagged messages are written to `memory/mesh/lessons/YYYY-MM-DD.md` and indexed by QMD.

---

## Status

| Component | Status |
|-----------|--------|
| Session cohesion (LCM bridge, dream cycle) | ✅ Live |
| Privacy filter | ✅ Live |
| Lesson tagging | ✅ Live |
| Agent guidelines | ✅ Written |
| Collaboration mesh (thread model) | 🔲 Designed, not yet built |

---

## Setup

```bash
git clone https://github.com/Kosfootel/mesh-memory
cd mesh-memory
npm install
node setup.mjs   # bootstraps token exchange with peer agents
```

See [DEPLOY.md](./DEPLOY.md) for full deployment instructions.
See [AGENT_GUIDELINES.md](./AGENT_GUIDELINES.md) for agent operating instructions.
See [ARCHITECTURE.md](./ARCHITECTURE.md) for full design documentation.

---

## Repo

[github.com/Kosfootel/mesh-memory](https://github.com/Kosfootel/mesh-memory) (private)
