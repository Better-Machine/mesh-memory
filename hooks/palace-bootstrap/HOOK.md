---
name: palace-bootstrap
description: "Loads Palace Memory context (L0-L4) into agent bootstrap"
metadata:
  openclaw:
    emoji: 🏰
    events:
      - agent:bootstrap
    requires:
      bins:
        - node
---

# Palace Bootstrap Hook

Automatically loads Palace Memory System context (L0-L4) when an agent session starts.

## What it does

1. Calls Palace wake-up hook to retrieve L0-L1 context
2. Formats critical facts as system prompt addendum
3. Injects Palace context into bootstrap files array

## Requirements

- Palace Daemon running on port 18810 (or local filesystem access)
- `palace-mvp/wakeup-hook.mjs` available
- Node.js for execution

## Configuration

```json
{
  "hooks": {
    "internal": {
      "entries": {
        "palace-bootstrap": {
          "enabled": true,
          "env": {
            "PALACE_USE_DAEMON": "true",
            "PALACE_DAEMON_URL": "http://localhost:18810"
          }
        }
      }
    }
  }
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PALACE_USE_DAEMON` | `true` | Use HTTP daemon vs direct file access |
| `PALACE_DAEMON_URL` | `http://localhost:18810` | Palace Daemon endpoint |
| `PALACE_MAX_FACTS` | `15` | Maximum L1 facts to inject |
| `PALACE_LOG_LEVEL` | `INFO` | Logging verbosity |

## Troubleshooting

If Palace context fails to load:
1. Check Palace Daemon: `curl http://localhost:18810/health`
2. Verify database exists: `ls ~/.openclaw/workspace/memory/palace/`
3. Check logs: `~/.openclaw/workspace/memory/palace/logs/palace-daemon.log`
