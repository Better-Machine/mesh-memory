# mesh-memory

![Status: Active](https://img.shields.io/badge/Status-Active-brightgreen)

Persistent cross-session memory for OpenClaw agents.

Built by Liz and Erik Ross · [Better Machine](https://bettermachine.ai)

---

## The problem

OpenClaw agents start fresh every session. They have context summaries, but no deep, searchable, self-maintaining memory. They forget lessons. They repeat mistakes. They lose the thread.

mesh-memory fixes that.

---

## What it does

Install it on any OpenClaw agent. That agent now:

- **Remembers across sessions** — LCM summaries are exported into searchable markdown, indexed automatically
- **Learns from mistakes** — tagged lessons, corrections, and decisions persist and survive session resets
- **Consolidates nightly** — dream cycle runs at 2 AM, distilling recent context into long-term memory
- **Respects privacy** — per-message and block-scoped suppression keeps sensitive context local
- **Shared pool** — bias-resistant structured fact store across agents, with temporal decay, read-path anonymization, and pre-retrieval blind gate to prevent anchoring bias

No peers required. No coordination. Works on day one with a single agent.

---

## Setup

```bash
git clone https://github.com/Better-Machine/mesh-memory
cd mesh-memory
npm install
cp mesh-memory.config.json mesh-memory.config.local.json
# edit config.local.json — set agentId, receiverToken (default port: 18803), watchPaths
npm start
```

See [DEPLOY.md](./DEPLOY.md) for full step-by-step instructions.

---

## Lesson tagging

Tag any message to build a persistent, searchable lessons log:

```
[lesson]     — insight or principle worth keeping
[correction] — corrects a prior error
[mistake]    — agent-acknowledged error
[decision]   — deliberate choice + rationale
[warning]    — known risk or gotcha
```

Tagged messages are written to `memory/mesh/lessons/YYYY-MM-DD.md` and indexed automatically.

---

## Privacy

| Method | How |
|--------|-----|
| Per-message | Include `private` anywhere in your message |
| Session block | `[private]` ... `[/private]` |
| Keyword config | Add terms to `privacy.keywords` in your local config |

```json
{
  "privacy": {
    "keywords": ["confidential", "salary", "nda"]
  }
}
```

Suppressed messages are not relayed or logged externally. A `[redacted — private message]` marker is kept locally so the agent knows a gap exists.

---

## Multi-agent (optional)

When you have multiple agents, mesh-memory supports consent-gated collaboration threads — ephemeral, scoped, user-approved.

**Peer relay is opt-in and disabled by default** (`relayEnabled: false`). Each agent owns their own memory. Cross-agent sharing only happens when agents actively choose to share something — via thread proposals or direct A2A messages. Nothing streams automatically between agents.

This is additive. Nothing breaks or degrades without peers. Add them when you need them.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design.

---

## Status (v0.1.0)

| Component | Status |
|-----------|--------|
| LCM bridge (cross-session memory export) | ✅ Live |
| Dream cycle (nightly consolidation) | ✅ Built — runs via cron, not `npm start` |
| Privacy filter | ✅ Live |
| Lesson tagging | ✅ Live |
| Agent guidelines | ✅ Written |
| Multi-agent peer relay | 🔲 Built — opt-in (`relayEnabled: true`) |
| Collaboration mesh threads | 🔲 Built — requires peer setup |
| Token expiry | ❌ Not implemented |
| Queue persistence across restarts | ❌ Not implemented |
| Storage rotation / pruning | ❌ Not implemented |

---

[DEPLOY.md](./DEPLOY.md) · [AGENT_GUIDELINES.md](./AGENT_GUIDELINES.md) · [ARCHITECTURE.md](./ARCHITECTURE.md)
