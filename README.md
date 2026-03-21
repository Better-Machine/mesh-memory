# mesh-memory

**Per-message, cross-session, cross-agent memory mesh for OpenClaw.**

Built by [Liz](https://github.com/LizSquirrelBot) and [Erik Ross](https://github.com/Kosfootel).

> "Every message. Every agent. One shared memory." 

## What it is

`mesh-memory` is an OpenClaw plugin that propagates agent memory in near-real-time across sessions and agents. Every message any agent sends or receives is extracted, filtered for signal, and shared with all peer agents via A2A — making the entire agent mesh operate from a shared, current understanding of context.

### Components

- **memory-watcher** — `fs.watch` daemon on session JSONL, fires on every write
- **memory-relay** — A2A transport layer, pushes structured memory events to peers  
- **memory-receiver** — ingests peer events, writes to shared QMD-indexed directory
- **memory-bridge** — exports LCM summaries from SQLite into QMD-searchable markdown
- **dream-cycle** — nightly cron that distills recent context into durable MEMORY.md updates

### Architecture

```
Session JSONL (local)
       │
  memory-watcher (fs.watch)
       │
  memory-relay (A2A push)
       │
  ─────┼──────────────────────────────────
       │            │              │
  Liz (.23)    Ray (.22)    Woodhouse (.24)
  memory-      memory-       memory-
  receiver     receiver      receiver
       │            │              │
  shared QMD index ──────────────────
       │
  memory_search (surgical recall, ~30s latency)
```

### Performance target

| Scenario | Target latency |
|---|---|
| Same agent, next session | < 60 seconds |
| Cross-agent, LAN | < 30 seconds (A2A) |
| LCM summary → searchable | < 60 seconds (bridge + QMD) |

## Installation

```bash
git clone https://github.com/Kosfootel/mesh-memory.git
cd mesh-memory
npm install
npm run setup    # interactive — creates coordination repo, handles token exchange with peers
npm start        # watcher + receiver + bridge
```

`setup.mjs` creates a private GitHub repo (`mesh-memory-coordination`) that all agents use to exchange receiver tokens without manual coordination. Run it on all nodes roughly simultaneously — it waits for peers automatically.

See [DEPLOY.md](DEPLOY.md) for full deployment guidance including timing, failure modes, and agent-specific operating notes.  
See [ARCHITECTURE.md](ARCHITECTURE.md) for system design.

## Status

🚧 **Active development** — pre-alpha

## Authors

- **Liz** — AI partner, Better Machine (@LizSquirrelBot)
- **Erik Ross** — Founder, Better Machine (@Kosfootel)

## License

MIT
