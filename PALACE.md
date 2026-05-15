# Palace Memory System

**Agent Memory Architecture for mesh-memory v2.0**

L0-L4 hierarchical memory with automatic wake-up context loading.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  L4: Kingdom          Multi-agent coordination              │
│  - Shared state with vector clocks                          │
│  - Distributed consensus                                    │
│  - Conflict resolution                                        │
├─────────────────────────────────────────────────────────────┤
│  L3: Temporal KG      Time-travel queries, audit trails     │
│  - Historical fact states                                     │
│  - Hash chain verification                                  │
│  - Retraction with provenance                               │
├─────────────────────────────────────────────────────────────┤
│  L2: Deep Memory      Searchable long-term storage          │
│  - FTS5 full-text search                                      │
│  - Semantic retrieval                                         │
│  - Lessons, events, observations                            │
├─────────────────────────────────────────────────────────────┤
│  L1: Critical Facts   Always-loaded standing instructions   │
│  - ILHCEV methodology                                       │
│  - QA gates, RFC requirements                             │
│  - Behavioral rules, blockers                               │
├─────────────────────────────────────────────────────────────┤
│  L0: Agent Passport   Portable identity                     │
│  - Agent ID, capabilities                                   │
│  - Hardware profile                                         │
│  - Mesh identity (receiver URL)                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### Wake-Up Context (Auto-Load)

```javascript
import { onSessionStart } from './palace-mvp/wakeup-hook.mjs';

// Called automatically on agent session start
const result = await onSessionStart();
// result.context: { l0: passport, l1: facts[], stats: {...} }
// result.systemPromptAddendum: Formatted for model injection
```

### Manual Access

```javascript
import { quickLoad } from './critical-facts-loader.mjs';

// Fast L0-L1 load
const context = await quickLoad();
// context.l0: passport
// context.l1: critical facts (max 15, ~1279 tokens)
```

---

## Components

| Layer | Module | Purpose |
|-------|--------|---------|
| L0-L1 | `critical-facts-loader.mjs` | Core database, wake-up context |
| L2 | `critical-facts-loader.mjs` | Deep memory search |
| L3 | `palace-tkg.mjs` | Temporal knowledge graph |
| L4 | `palace-kingdom.mjs` | Multi-agent coordination |
| Hook | `palace-mvp/wakeup-hook.mjs` | Session auto-load |
| Daemon | `palace-daemon.mjs` | HTTP API for L0-L2 |

---

## Data Model

### L1 Critical Fact

```javascript
{
  id: 'standing-ilhcev-001',
  tier: 'critical',
  category: 'standing_instructions',
  type: 'decision',
  content: {
    title: 'ILHCEV Problem-Solving Methodology',
    body: 'Before any implementation...',
    tags: ['methodology', 'standing-instruction']
  },
  provenance: {
    source: 'AGENTS.md',
    author: 'Mr. Ross',
    timestamp: '2026-03-23T00:00:00Z'
  },
  updated_at: '2026-03-23T00:00:00Z',
  expires_at: null
}
```

### L2 Deep Fact

```javascript
{
  id: 'lesson-magicdns-001',
  tier: 'deep',
  category: 'infrastructure',
  type: 'observation',
  content: { title, body, tags },
  // Same provenance structure
}
```

---

## API

### Palace Daemon (HTTP)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/wake-up-context` | GET | Get L0-L1 context |
| `/facts/critical` | GET | List L1 facts |
| `/facts/search?q={query}` | GET | Search L2 |
| `/metrics` | GET | Daemon metrics |

```bash
# Start daemon
node palace-daemon.mjs

# Or systemd
sudo systemctl enable --now palace-daemon

# Test
curl http://localhost:18810/wake-up-context
```

---

## Seeding

### Initial Data

```bash
# Seed L1/L2 facts from MEMORY.md
node palace-mvp/seed-critical-facts.mjs

# Sync L1 → L3 (Temporal)
node palace-mvp/sync-tkg.mjs
```

### Custom Facts

```javascript
import { createLoader } from './critical-facts-loader.mjs';

const loader = await createLoader({ dbPath: './my-palace.db' });

loader.insertFact({
  id: 'custom-001',
  tier: 'critical',
  category: 'projects',
  type: 'decision',
  content: { title: '...', body: '...', tags: [] },
  provenance: { source: 'user', author: 'liz', timestamp: new Date().toISOString() }
});
```

---

## Integration

### OpenClaw Session Hook

Add to agent bootstrap:

```javascript
import { onSessionStart } from './palace-mvp/wakeup-hook.mjs';

// In session initialization
const palace = await onSessionStart();
if (palace.success) {
  systemPrompt += palace.systemPromptAddendum;
}
```

### Manual Context Loading

```javascript
import { loadFullPalaceContext } from './palace-mvp/wakeup-hook.mjs';

const full = await loadFullPalaceContext({
  includeTemporal: true,   // L3
  includeKingdom: true     // L4
});
// full.l0, full.l1, full.l3, full.l4
```

---

## Testing

```bash
# Test all layers
npm run test:palace

# Individual tests
node palace-mvp/test-wakeup-hook.mjs
node palace-mvp/test-kingdom.mjs
node palace-mvp/sync-tkg.mjs

# Daemon tests
./scripts/test-palace-daemon.sh
```

---

## Storage

```
~/.openclaw/workspace/memory/palace/
├── critical-facts.db      # L1 + L2
├── palace-tkg.db          # L3 Temporal
├── palace-kingdom.db      # L4 Coordination
└── logs/
    ├── palace-daemon.log
    ├── palace-tkg.log
    └── palace-kingdom.log
```

---

## Configuration

Environment variables:

```bash
PALACE_PORT=18810
PALACE_HOST=0.0.0.0
PALACE_DB_PATH=/path/to/critical-facts.db
PALACE_PASSPORT_PATH=/path/to/agent-passport.json
PALACE_LOG_LEVEL=INFO
PALACE_CLEANUP_INTERVAL=60
```

---

## Status

| Component | Status | Tests |
|-----------|--------|-------|
| L0-L1 Loader | ✅ Complete | ✅ 32 passing |
| L2 Search | ✅ Complete | ✅ FTS5 working |
| L3 Temporal | ✅ Complete | ✅ Time-travel, retraction |
| L4 Kingdom | ✅ Complete | ✅ Vector clocks, consensus |
| Wake-Up Hook | ✅ Complete | ✅ Auto-load |
| Palace Daemon | ✅ Complete | ✅ HTTP API |
| **Overall** | **✅ Ready** | **✅ All passing** |

---

## Next Steps

1. **Deploy Daemon**: `sudo systemctl enable --now palace-daemon`
2. **OpenClaw Integration**: Add `onSessionStart()` to agent bootstrap
3. **Mesh Sync**: Connect L4 Kingdom to Ray/Woodhouse nodes
4. **Monitoring**: Health checks, alerts

---

*Palace: Where agents remember who they are.*
