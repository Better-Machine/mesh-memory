# mesh-memory Architecture

**Per-message, cross-session, cross-agent memory mesh for OpenClaw.**

## Overview

mesh-memory creates a real-time shared memory layer across OpenClaw agents. Every substantive message any agent sends or receives is extracted, filtered, and propagated to all peer agents — giving the entire mesh a shared, current understanding of context.

The novel contribution is bridging two existing OpenClaw subsystems:
- **LCM** (Local Conversation Memory) — per-session summaries stored in SQLite
- **QMD** (Query Memory Directory) — file-based memory indexed for semantic search

mesh-memory connects these by exporting LCM summaries as QMD-searchable markdown and relaying real-time messages across agents via A2A.

## System Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Agent: Liz (.23)                        │
│                                                             │
│  Session JSONL ──→ memory-watcher ──→ memory-relay ──┐     │
│       (fs.watch)        │                  (A2A POST)│     │
│                         │                            │     │
│  lcm.db ──→ memory-bridge ──→ memory/lcm/*.md        │     │
│       (SQLite poll)                                  │     │
│                                                      │     │
│  memory/mesh/*.md ←── memory-receiver (port 18801)   │     │
│       │                     ↑                        │     │
│       └── QMD auto-indexes  │                        │     │
│                             │                        │     │
│  dream-cycle (2AM cron) ───→ dream-cycle-YYYY-MM-DD.md     │
│       (reads mesh/ + lcm/, suggests MEMORY.md updates)     │
└─────────────────────────┬───────────────────────────────────┘
                          │ A2A
              ┌───────────┼───────────┐
              ▼           ▼           ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  Ray (.22)   │ │Woodhouse(.24)│ │  Future peer │
│  receiver    │ │  receiver    │ │  receiver    │
│  :18801      │ │  :18801      │ │  :18801      │
└──────────────┘ └──────────────┘ └──────────────┘
```

## Data Flow

### Real-time path (< 30s target)

```
1. Agent writes message to session JSONL
2. memory-watcher detects write (chokidar, ~200ms stabilization)
3. Watcher reads delta, parses JSONL, filters for substantive turns
4. memory-relay POSTs MemoryEvent to all peers (parallel, rate-limited)
5. Peer memory-receiver validates and writes to memory/mesh/YYYY-MM-DD.md
6. QMD indexes the new file (~10-30s)
7. Peer agent can now search/recall the message
```

### LCM bridge path (< 60s target)

```
1. LCM writes conversation summary to lcm.db (SQLite)
2. memory-bridge polls SQLite on interval (default: 60s)
3. New summaries exported to memory/lcm/YYYY-MM-DD.md
4. QMD indexes the new file
5. Agent can now search LCM summaries alongside mesh events
```

### Dream cycle path (nightly)

```
1. Cron triggers dream-cycle.mjs at 2-3 AM
2. Reads all memory/mesh/*.md and memory/lcm/*.md from last 24h
3. Builds consolidation prompt
4. Calls OpenClaw agent API for MEMORY.md suggestions
5. Writes dream-cycle-YYYY-MM-DD.md for human review
6. Erik approves and merges into MEMORY.md
```

## MemoryEvent Schema

```json
{
  "agentId": "liz",
  "sessionKey": "session-abc123",
  "role": "assistant",
  "content": "The deployment finished successfully...",
  "timestamp": "2026-03-21T14:30:00.000Z"
}
```

## Components

### memory-watcher.mjs
- Watches session JSONL paths via chokidar
- Tracks byte offsets per file for efficient delta reads
- Filters: skips tool calls, system messages, short content
- Emits MemoryEvents to the relay

### memory-relay.mjs
- Sends events to all peers via HTTP POST (A2A pattern)
- Rate-limited: max 1 event/second/peer (configurable)
- Queue-based: events buffer during rate limit windows
- Graceful: one peer failing doesn't block others

### memory-receiver.mjs
- Express server on configurable port (default: 18801)
- Bearer token authentication
- Validates event structure before writing
- Appends to daily markdown: `## [HH:MM:SS] agent (role)\ncontent`
- Health check endpoint at GET /health

### memory-bridge.mjs
- Polls lcm.db SQLite for new summaries
- Tracks cursor in ~/.openclaw/mesh-memory-cursor.json
- Auto-discovers table/column names
- Writes to memory/lcm/YYYY-MM-DD.md

### dream-cycle.mjs
- Reads last 24h of mesh + LCM markdown
- Generates consolidation prompt
- Calls OpenClaw agent API
- Writes suggestions (does NOT auto-modify MEMORY.md)

### config.mjs
- Shared config loader for all modules
- Reads mesh-memory.config.json from project root
- Caches after first load

## Latency Targets

| Path | Target | Bottleneck |
|------|--------|------------|
| Watcher → Relay | < 500ms | chokidar stabilization (200ms) |
| Relay → Receiver | < 1s | Network + rate limit |
| Receiver → QMD | < 30s | QMD indexing interval |
| **End-to-end (real-time)** | **< 30s** | QMD pickup |
| Bridge → QMD | < 60s | Poll interval + QMD |
| Dream cycle | N/A (batch) | Agent API response time |

## Configuration Reference

All config lives in `mesh-memory.config.json`:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `agentId` | string | — | This agent's identifier |
| `receiverPort` | number | 18801 | Port for incoming events |
| `receiverToken` | string | — | Bearer token for auth |
| `peers` | array | [] | Peer agents to relay to |
| `peers[].name` | string | — | Peer display name |
| `peers[].url` | string | — | Peer receiver URL |
| `peers[].token` | string | — | Peer's bearer token |
| `watchPaths` | string[] | — | Session JSONL directories |
| `bridgeInterval` | number | 60 | LCM poll interval (seconds) |
| `relayRateLimit` | number | 1000 | Min ms between sends per peer |
| `filter.minContentLength` | number | 20 | Skip short messages |
| `filter.skipRoles` | string[] | ["tool","system"] | Roles to skip |

## Installation

```bash
# Clone the repo
git clone https://github.com/Kosfootel/mesh-memory.git
cd mesh-memory

# Install dependencies
npm install

# Edit config
cp mesh-memory.config.json mesh-memory.config.json
# Set agentId, receiverToken, and peer URLs

# Start all services
npm start

# Or run individually
npm run watcher    # Session file watcher
npm run receiver   # HTTP event receiver
npm run bridge     # LCM → QMD bridge

# Set up dream cycle cron
crontab -e
# Add: 0 2 * * * cd /path/to/mesh-memory && node dream-cycle.mjs
```

## How mesh-memory bridges LCM + QMD

This is the core architectural insight:

**LCM** stores rich conversation summaries in SQLite, but they're only accessible to the local agent via SQL queries. Other agents can't see them, and they're not searchable via QMD.

**QMD** indexes markdown files for semantic search, making them available to any agent that can read the filesystem. But QMD doesn't know about LCM's SQLite database.

**mesh-memory** bridges the gap:
1. `memory-bridge` continuously exports LCM summaries as markdown → QMD picks them up
2. `memory-relay` + `memory-receiver` propagate real-time messages across agents → written as markdown → QMD picks them up
3. `dream-cycle` consolidates both streams into actionable MEMORY.md suggestions

The result: every agent in the mesh can search and recall context from every other agent's conversations, with latency under 60 seconds.

## Authors

- **Liz** — AI partner, Better Machine (@LizSquirrelBot)
- **Erik Ross** — Founder, Better Machine (@Kosfootel)
