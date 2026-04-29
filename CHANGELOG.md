# Changelog

All notable changes to mesh-memory are documented here.

---

## [1.0.1] — 2026-04-28

### What's in this release

Hotfix release addressing a critical bug in TunnelPublisher.

### Fixed

- **TunnelPublisher missing method** - Added `publishToPeer()` method that was referenced in `publishFact()` but never implemented. This prevented facts from being published to mesh peers. Method properly wraps `postFactToPeer()` with token fallback and correlation ID support.

---

## [0.1.0] — 2026-03-22

### What's in this release

This is the first release. It is production-ready for single-agent use. Multi-agent features are built and available but are not the default.

---

### Layer 1 — Single-agent persistent memory

Everything in Layer 1 works out of the box with no peers configured.

**Cross-session memory (LCM bridge)**
- `memory-bridge.mjs` polls the OpenClaw LCM SQLite database on a configurable interval
- New summaries are exported to `~/.openclaw/workspace/memory/lcm/YYYY-MM-DD.md`
- Export cursor tracks position between runs; no duplicate writes
- Handles multiple LCM table schemas (summaries, summary, lcm_summaries, entries)

**Privacy filter** (`privacy.mjs`)
- Per-message suppression: include `private` anywhere in a message
- Session-scoped suppression: `[private]` / `[/private]` block commands
- Keyword-based suppression: configure `privacy.keywords` in your local config
- Suppressed messages are never relayed; a `[redacted — private message]` marker is written locally so agents know a gap exists
- Sensitivity hints surface patterns that agents may want to flag to users (credentials, health, legal, financial topics)
- Session state is cleaned up when JSONL files are removed (no stale private-mode state)

**Lesson tagging** (`lesson-tagger.mjs`)
- Five tag types: `[lesson]`, `[correction]`, `[mistake]`, `[decision]`, `[warning]`
- Tags can appear anywhere in a message; they are stripped from the stored content
- Tagged entries are written to `~/.openclaw/workspace/memory/mesh/lessons/YYYY-MM-DD.md`
- Agent self-tagging heuristics surface suggestions for likely corrections and decisions

**Dream cycle** (`dream-cycle.mjs`)
- Reads recent mesh and LCM markdown files (last 24h window)
- Calls the local OpenClaw agent API to generate MEMORY.md update suggestions
- Writes suggestions to `~/.openclaw/workspace/memory/dream-cycle-YYYY-MM-DD.md`
- Intended to run nightly via cron at 2 AM — not started by `npm start`
- Does NOT write directly to MEMORY.md; agent reviews and applies suggestions manually

**Memory watcher** (`memory-watcher.mjs`)
- Watches session JSONL files using chokidar
- Emits MemoryEvents with privacy and tag enrichment
- Writes to local mesh markdown and (optionally) relays to peers

---

### Layer 2 — Consent-gated multi-agent threads

Layer 2 is built, tested, and available. It is disabled by default (`relayEnabled: false`).

**Thread system** (`thread-manager.mjs`, `thread-propose.mjs`, `thread-consent.mjs`, `thread-context.mjs`, `thread-close.mjs`, `thread-notify.mjs`)
- Agents can propose collaboration threads to peers
- Peer agents receive proposals and accept/reject based on known-agent allowlist
- Accepted threads are scoped: each has its own token, participant list, and context log
- Threads can be explicitly closed by any participant
- User notification fires via OpenClaw system events on proposal and closure

**Peer relay** (`memory-relay.mjs`)
- Events are queued and flushed to peer agents over HTTP
- Queue depth capped at `relayMaxQueueDepth` (default 500); oldest events are dropped if full
- Privacy hints and tagging metadata are stripped before relay (M8 fix)
- `relayEnabled` must be explicitly set to `true` to activate

---

### Security — 20 fixes applied (liz/bug-fixes)

All fixes passed 82/82 QA tests on 2026-03-22. Full details in `tests/QA_REPORT.md`.

| ID | Area | Fix |
|----|------|-----|
| C1 | Shell injection | `execFile` replaces bare `exec` in thread-notify.mjs |
| H1 | Path traversal | UUID validation on all threadId parameters |
| H2 | Consent auto-accept | Proposals from unknown agents are rejected, not auto-accepted |
| H3 | Offset data loss | `readDelta` does not advance file offsets; caller advances per successfully-processed line |
| M1 | Thread close auth | Non-participant agents receive 403 |
| M2 | Unhandled rejection | `.catch()` on all `flushPeer` calls |
| M3 | Queue cap | Queue depth enforced; oldest event dropped when full |
| M4 | Hardcoded port | Thread port sourced from config |
| M6 | Timestamp validation | Invalid ISO 8601 timestamps return 400 |
| M7 | Port conflict | `.on("error")` handler on all HTTP servers; clean exit on EADDRINUSE |
| M8 | Privacy hint leak | `privacyHints` and `suggestedTag` stripped before peer relay |
| L1 | Health endpoint | `/health` returns `{ status: "ok" }` without agentId |
| L6 | Redacted notice | Suppressed messages write a local redacted marker |
| L7 | Session cleanup | Private mode state cleared when JSONL files are removed |
| L8 | Async error handling | `.catch()` on all chokidar event handlers |
| + 5 more | Various | See QA_REPORT.md for full list |

---

### What is NOT in v0.1.0

These features are planned but not implemented in this release:

- **Token expiry** — thread tokens do not expire; revocation is manual
- **Queue persistence** — the relay queue is in-memory; events in the queue are lost on restart
- **Storage rotation** — mesh markdown and lesson files accumulate without automatic archiving or pruning
- **Demographic filtering** — identity resolver stores context but does not filter on demographic signals
- **Embedding-based memory search** — memory is stored as markdown and searched by text; no vector index
- **Automatic MEMORY.md writes** — dream cycle generates suggestions; agent applies them manually

---

### Known limitations

- The dream cycle calls the OpenClaw agent API at `http://localhost:3000/api/chat` (or as configured). If OpenClaw is not running, the dream cycle will fail silently with a logged error. This is expected.
- Stress tests T3, L2-1, and L2-2 require live peer agents to pass. They fail in single-agent environments by design.
- `npm start` does not launch the dream cycle. Add it to cron separately (see DEPLOY.md).

---

## Pre-release history (not versioned)

Development and security hardening occurred on the `liz/bug-fixes` branch prior to this release. See `git log` for the full history.
