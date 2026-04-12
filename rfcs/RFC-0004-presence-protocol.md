# RFC-0004: Presence Protocol v1.0 for Cross-Agent Awareness

**Status:** Draft  
**Author(s):** Liz  
**Created:** 2026-04-12  
**Last Updated:** 2026-04-12  
**Supersedes:** —  
**Superseded by:** —

---

## Summary

This RFC proposes a Presence Protocol that enables agents to broadcast near-real-time awareness of their current activity to other mesh participants. Currently, agents operate in isolated session trees with no shared "now"—this protocol provides a lightweight mechanism for agents to discover what peers are doing, who they're talking to, and what topics they're engaged with. Target latency: 5-30 seconds (acceptable for human-scale context switching).

---

## Motivation

**The problem:** Agents currently have no visibility into peer activity. When Erik switches between Liz (Telegram) and Ray (Discord), neither agent knows the other is engaged. This leads to:
- Duplicate efforts when both agents work on related tasks
- Missed opportunities for coordination on shared projects
- Fragmented context when the human expects agents to be aware of ongoing work
- No way to gracefully handle simultaneous direct messages

**What breaks without this:** Agents operate as silos. The "machine" that Ray and Liz are meant to be cannot function as a coordinated unit.

---

## Prior Art / Existing Approaches

### XMPP Presence (RFC 6121)
The classic presence protocol uses `<presence>` stanzas with show/status/priority. Lessons: simple state machine, subscription model, but overkill for our mesh.

### Discord Presence Gateway Events
Discord uses `PRESENCE_UPDATE` gateway events with `activities`, `status` (online/idle/dnd/offline), and `client_status`. Lessons: activity objects are flexible, status transitions are well-defined.

### Slack User Presence API
Slack uses `users.getPresence` returning `presence` (active/away) and `online` boolean. Limited but effective for human-scale latency.

### MQTT Last Will and Testament
MQTT brokers handle client disconnection via LWT messages. Relevant for our "leaving" lifecycle.

### In Our Codebase
- A2A messages support `message_type` with metadata
- Mesh-memory has SQLite backing with tables for messages
- No existing presence system—greenfield design

---

## Detailed Design

### 1. Presence Message Schema

```json
{
  "protocol": "a2a-presence",
  "version": "1.0",
  "presence": {
    "agent": {
      "id": "liz",
      "passport_ref": "passport://liz/better-machine/agents/v1",
      "display_name": "Liz"
    },
    "session": {
      "id": "sess_abc123",
      "type": "direct_msg",
      "started_at": "2026-04-12T09:30:00Z"
    },
    "context": {
      "human_id": "erik-ross",
      "human_handle": "erikrosspgh",
      "channel": "telegram",
      "channel_id": "@LizSquirrelBot"
    },
    "topic": {
      "primary": "presence-protocol-design",
      "tags": ["rfc", "a2a", "coordination"],
      "project": "incubate"
    },
    "status": "active",
    "priority": "normal",
    "visibility": "mesh-wide",
    "timestamp": "2026-04-12T09:35:00Z",
    "ttl_seconds": 60
  }
}
```

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agent.id` | string | Yes | Agent short identifier (liz, ray, woodhouse) |
| `agent.passport_ref` | URI | Yes | L0 passport reference |
| `session.id` | string | Yes | Unique session identifier |
| `session.type` | enum | Yes | `direct_msg`, `heartbeat`, `subagent_task`, `cron`, `background` |
| `session.started_at` | ISO8601 | Yes | Session start time |
| `context.human_id` | string | Yes | Human identifier |
| `context.channel` | string | Yes | Platform/channel name |
| `topic.primary` | string | No | High-level topic/description |
| `topic.tags` | array | No | Categorization tags |
| `topic.project` | string | No | Associated project |
| `status` | enum | Yes | `active`, `idle`, `away`, `offline` |
| `priority` | enum | Yes | `low`, `normal`, `high`, `critical` |
| `visibility` | enum | Yes | `private`, `mesh-wide`, `peers:[id1,id2]` |
| `timestamp` | ISO8601 | Yes | Message creation time |
| `ttl_seconds` | integer | Yes | Time-to-live before stale |

### 2. Transport

**Primary:** A2A broadcast via mesh-memory receiver endpoints

Each agent publishes presence to its local receiver:
```
POST /receiver/presence
Content-Type: application/json

{ presence message }
```

Receivers broadcast to all known peers via A2A `message_type: presence_update`.

**Secondary:** Shared SQLite "presence table" (cache of last-known)

```sql
CREATE TABLE presence_cache (
  agent_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  session_type TEXT NOT NULL,
  human_id TEXT,
  status TEXT NOT NULL,
  topic_primary TEXT,
  topic_tags TEXT, -- JSON array
  timestamp TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  raw_json TEXT NOT NULL
);

CREATE INDEX idx_presence_human ON presence_cache(human_id);
CREATE INDEX idx_presence_expires ON presence_cache(expires_at);
```

Agents query: `SELECT * FROM presence_cache WHERE expires_at > datetime('now')`

### 3. State Machine

```
                     ┌─────────────┐
    start_session ──►│  ENTERING   │
                     └──────┬──────┘
                            │ publish "entering"
                            ▼
                     ┌─────────────┐
                     │   ACTIVE    │◄────┐
                     └──────┬──────┘     │
                            │            │
              update_topic ─┤            │
              update_human ─┤            │ heartbeat/renew
              set_idle ─────┤            │
                            │            │
                     ┌──────┴──────┐     │
                     │  TOPIC_CHANGE │─────┘
                     └──────┬──────┘
                            │ publish "topic_change"
                            ▼
                     ┌─────────────┐
    end_session ─────►│   LEAVING   │
                     └──────┬──────┘
                            │ publish "leaving"
                            ▼
                     ┌─────────────┐
                     │  OFFLINE    │
                     └─────────────┘
```

**Transitions:**
- `entering`: New session starts → broadcast presence, set TTL timer
- `topic_change`: Context changes → broadcast updated presence
- `leaving`: Session ends → broadcast final presence with `status: offline`
- `expired`: TTL reached without heartbeat → peer marks as stale/offline

**TTL/Renewal:** Agents must heartbeat every `ttl_seconds/2` (default: 30s for 60s TTL).

### 4. Conflict Resolution

**Scenario:** Two agents claim the same human in `direct_msg` sessions.

**Resolution strategy: Priority Tiers + Last-Write-Wins**

| Priority | Session Type | Resolution |
|----------|--------------|------------|
| 1 (highest) | `direct_msg` | Active direct message wins |
| 2 | `subagent_task` | Task work in progress |
| 3 | `heartbeat` | Routine check |
| 4 | `cron` | Scheduled background |
| 5 (lowest) | `background` | Passive activity |

**Rules:**
1. Higher priority always wins over lower priority
2. Same priority: last-write-wins (newer timestamp)
3. Agents can query human status: `GET /presence/human/{human_id}`
4. Conflict detected when `human_id` appears in multiple `direct_msg` sessions

**Graceful degradation:** If conflict persists >5 minutes, agents may notify human: "Both Liz and Ray are active. Who should I coordinate with?"

---

## Example

### Agent Liz starts a direct message session

**Liz publishes:**
```json
{
  "protocol": "a2a-presence",
  "version": "1.0",
  "presence": {
    "agent": {"id": "liz", "passport_ref": "passport://liz/..."},
    "session": {"id": "sess_liz_001", "type": "direct_msg", "started_at": "2026-04-12T09:30:00Z"},
    "context": {"human_id": "erik-ross", "human_handle": "erikrosspgh", "channel": "telegram"},
    "topic": {"primary": "RFC design", "tags": ["presence", "protocol"], "project": "incubate"},
    "status": "active",
    "priority": "high",
    "visibility": "mesh-wide",
    "timestamp": "2026-04-12T09:30:00Z",
    "ttl_seconds": 60
  }
}
```

**Ray receives via A2A:**
```json
{
  "message_type": "presence_update",
  "sender": "liz",
  "payload": { /* presence object */ },
  "received_at": "2026-04-12T09:30:01Z"
}
```

**Ray queries current mesh:**
```bash
$ curl http://ray-node:8080/receiver/presence/agents
{
  "agents": [
    {
      "agent_id": "liz",
      "status": "active",
      "session_type": "direct_msg",
      "human_id": "erik-ross",
      "topic_primary": "RFC design",
      "since": "2026-04-12T09:30:00Z"
    }
  ]
}
```

**Ray sees Erik is occupied, defers non-urgent message.**

---

## Alternatives Considered

| Alternative | Why Considered | Why Rejected |
|-------------|---------------|--------------|
| **XMPP-style presence** | Robust, battle-tested | Too complex; requires subscription model; overkill for 3-agent mesh |
| **Shared SQLite only** | Simple, no network | Doesn't scale; requires polling; latency too high for real-time |
| **Redis pub/sub** | Fast, low latency | Adds new dependency; violates 12-factor backing service preference |
| **WebSocket mesh** | Bidirectional, real-time | Requires persistent connections; more complexity than needed |
| **Human arbitration for all conflicts** | Simple to implement | Too disruptive; human shouldn't be bothered for routine coordination |

---

## Impact Assessment

### Breaking Changes
- [ ] No breaking changes (new protocol, additive only)

### Affected Components
- `mesh-memory` — add presence table, `/receiver/presence` endpoint
- `a2a-messaging` — handle `presence_update` message type
- All agents — implement presence publishing on session lifecycle events

### Security Considerations
- Presence reveals which human an agent is talking to — acceptable for mesh-wide visibility
- `visibility: private` prevents exposure outside agent's node
- Passport reference validates agent identity

### Performance Considerations
- 3 agents × 60s TTL = ~3 presence messages/minute baseline
- Heartbeat doubles traffic: ~6 messages/minute per agent
- Negligible overhead; SQLite cache is O(1) lookup

### Twelve-Factor Considerations
- Presence state is ephemeral; SQLite cache is backing service
- No stateful in-process data
- TTL/heartbeat interval configurable via env vars

---

## Open Questions

1. Should agents include sentiment/mood in presence? (e.g., `state: focused`, `state: interrupted`)
2. Do we need presence history, or only current state?
3. How should agents handle visibility `peers:[id1,id2]` — explicit allowlist in config?
4. Should presence include session depth (subagent nesting level)?

---

## Review Checklist

Before this RFC moves from Draft → Under Review:
- [x] Prior art section is complete
- [x] At least one concrete example is provided
- [x] Alternatives considered section is complete
- [x] Breaking changes explicitly called out
- [x] Security considerations addressed

Before this RFC moves from Under Review → Accepted:
- [ ] All three agents have reviewed and commented
- [ ] Erik has approved
- [ ] Open questions are resolved or explicitly deferred
- [ ] Affected components list is finalized

---

## Decision

*To be filled in upon acceptance.*

---

## Implementation Notes

*To be filled in after acceptance.*
