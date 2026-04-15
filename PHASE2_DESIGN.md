# Mesh-Memory Phase 2 Design

**Date:** 2026-04-13  
**Status:** Design Phase  
**Goal:** Production-hardening — storage rotation, token lifecycle, queue persistence

---

## Overview

Phase 2 addresses three critical production gaps:
1. **Unbounded storage growth** — mesh logs grow forever
2. **Static tokens** — no expiry, rotation, or revocation
3. **Volatile queues** — relay queues lost on crash/restart

These features turn mesh-memory from "working prototype" to "production-ready infrastructure."

---

## 1. Storage Rotation & Pruning

### Problem
- `memory/mesh/YYYY-MM-DD.md` files accumulate forever
- Old threads in `memory/threads/` remain indefinitely
- No policy for when to archive vs. delete

### Solution: Tiered Retention Policy

**Config schema additions:**
```json
{
  "storage": {
    "meshLogRetentionDays": 30,
    "threadRetentionDays": 7,
    "archiveEnabled": true,
    "archivePath": "~/.openclaw/workspace/memory/archive",
    "pruneIntervalHours": 24
  }
}
```

**Behavior:**
- **Active tier (0-30 days):** Mesh logs live in `memory/mesh/`, fully indexed by QMD
- **Archive tier (30-90 days):** Compressed to `.tar.gz` in `memory/archive/mesh/`
- **Cold tier (90+ days):** Deleted (or moved to long-term storage if configured)

**Implementation:**
- New module: `storage-rotation.mjs`
- Background cron: runs every `pruneIntervalHours` (default: 24h)
- Archives: `tar -czf archive/mesh/YYYY-MM-DD.tar.gz mesh/YYYY-MM-DD.md`
- Thread cleanup: `memory/threads/` scanned for `manifest.json` with `closedAt` timestamp

**Safety:**
- Only prunes files older than retention period
- Archives are verified (tar -tzf) before source deletion
- Logs every action: archived, pruned, skipped

---

## 2. Token Lifecycle (Generation, Expiry, Rotation)

### Problem
- Tokens are static strings in config
- No expiry — compromised token is valid forever
- No rotation — can't revoke old tokens without config edit
- Manual token exchange via chat is error-prone

### Solution: Ephemeral Tokens with Refresh

**New concepts:**
- **Master token:** Long-lived, never leaves the machine (stored in `mesh-memory.config.local.json` only)
- **Ephemeral token:** Short-lived (24h), used for relay/receiver/thread endpoints
- **Token service:** HTTP endpoint for token issuance and rotation

**Config schema additions:**
```json
{
  "token": {
    "masterToken": "<long-random-string>",
    "ephemeralTokenTtlHours": 24,
    "autoRotate": true,
    "rotationIntervalHours": 12
  }
}
```

**Token service endpoints:**
```
POST /mesh/token/issue
  Auth: Bearer <master-token>
  Body: { "peerName": "ray", "ttlHours": 24 }
  Response: { "token": "abc...", "expiresAt": "2026-04-14T12:00:00Z" }

POST /mesh/token/rotate
  Auth: Bearer <old-ephemeral-token>
  Response: { "token": "xyz...", "expiresAt": "2026-04-15T12:00:00Z" }

POST /mesh/token/revoke
  Auth: Bearer <master-token>
  Body: { "token": "abc..." }
  Response: { "ok": true }
```

**Implementation:**
- New module: `token-service.mjs`
- Token storage: SQLite table `tokens(peerName, token, issuedAt, expiresAt, revoked)`
- Background rotation: `token-service.mjs` runs as managed service with cron
- Automatic rotation: 12h before expiry, new token issued, old token marked `revoked`

**Migration path:**
- Phase 1 tokens become "legacy tokens" — still valid but marked deprecated
- Setup script prompts to generate master token on first run
- Agents exchange master tokens via blind-gate protocol (already built)

**Security:**
- Master token never logged
- Ephemeral tokens logged only on issuance (not on every use)
- Revoked tokens are rejected immediately (in-memory cache of revoked list)

---

## 3. Queue Persistence & Replay

### Problem
- `memory-relay.mjs` stores queues in memory (`pendingQueues` Map)
- On crash or restart, unsent events are lost
- No way to resume relay from last known position

### Solution: Disk-Backed Queue with WAL

**New module: `queue-persistence.mjs`**

**Queue structure:**
```
memory/queue/
├── wal/           # Write-ahead log (append-only)
│   ├── 000001.log
│   ├── 000002.log
│   └── ...
├── snapshots/     # Periodic full queue state
│   └── snapshot-2026-04-13T12:00:00Z.json
└── index.db       # SQLite index for fast lookups
```

**Write path:**
1. Event arrives → append to WAL (fast, sequential write)
2. WAL fsync() → ack to caller
3. Background: WAL entries moved to SQLite index

**Read path (replay on startup):**
1. Load latest snapshot
2. Replay WAL entries after snapshot timestamp
3. Rebuild in-memory queue state

**Retention:**
- WAL files: kept for 7 days (for crash recovery)
- Snapshots: one per day, kept for 30 days
- Process: snapshot → verify → delete old WAL files

**Implementation details:**
- Use SQLite for queue index (peerName, eventId, timestamp, status: pending|sent|failed)
- WAL is newline-delimited JSON (one event per line)
- Snapshot is full queue state as JSON
- Background thread: every 10 minutes, rotate WAL if >10MB

**Changes to `memory-relay.mjs`:**
```javascript
import { persistEvent, loadQueueState } from "./queue-persistence.mjs";

// On startup
const pendingQueues = await loadQueueState();

// On event relay
await persistEvent(peerName, event);
```

**Failure modes:**
- Crash during write: WAL is replayed, no data loss
- Snapshot corruption: fall back to older snapshot + WAL replay
- Disk full: queue stops accepting new events (backpressure), logs error

---

## 4. Configuration Schema Updates

**New `mesh-memory.config.json` structure:**

```json
{
  "agentId": "liz",
  "receiverPort": 18801,
  "threadPort": 18802,
  "token": {
    "masterToken": "<generate-this>",
    "ephemeralTokenTtlHours": 24,
    "autoRotate": true,
    "rotationIntervalHours": 12
  },
  "peers": [
    {
      "name": "ray",
      "url": "http://192.168.50.22:18801",
      "token": "<ephemeral-token-from-token-service>"
    }
  ],
  "relayEnabled": true,
  "relayRateLimit": 1000,
  "relayMaxQueueDepth": 500,
  "storage": {
    "meshLogRetentionDays": 30,
    "threadRetentionDays": 7,
    "archiveEnabled": true,
    "archivePath": "~/.openclaw/workspace/memory/archive",
    "pruneIntervalHours": 24
  },
  "queue": {
    "persistenceEnabled": true,
    "walMaxSizeMB": 10,
    "snapshotIntervalHours": 24,
    "retentionDays": 7
  }
}
```

**Backwards compatibility:**
- All new fields are optional
- Missing `storage` section → no rotation (current behavior)
- Missing `token` section → use static tokens (current behavior)
- Missing `queue` section → in-memory queues only (current behavior)

---

## 5. Migration Path from Phase 1

### Step 1: Install Phase 2 (Zero-Downtime)
```bash
cd projects/mesh-memory
git checkout main
git pull origin main

# Install new dependencies
npm install

# Run setup (generates master token, migrates config)
npm run setup
```

**Setup script actions:**
1. Detects Phase 1 config (static tokens)
2. Generates master token (prompts user to store safely)
3. Issues ephemeral tokens for each peer
4. Writes new config with `token` section
5. Creates queue persistence directories
6. Starts token service as systemd service

### Step 2: Rolling Restart (One Agent at a Time)

**On Liz:**
```bash
# Stop old services
sudo systemctl stop mesh-memory-receiver
sudo systemctl stop mesh-memory-relay

# Start new services (includes token service)
sudo systemctl start mesh-memory-receiver  # now uses ephemeral token
sudo systemctl start mesh-memory-relay     # now persists queues
sudo systemctl start mesh-memory-token     # new token service

# Verify
sudo systemctl status mesh-memory-*
```

**On Ray:**
- Same steps, but Liz's token service issues his ephemeral token
- Token exchange happens via blind-gate protocol (already built)

**On Woodhouse:**
- Same steps

### Step 3: Verify Phase 2 Features

**Storage rotation:**
```bash
# Force a prune run
node storage-rotation.mjs --dry-run
# Check logs: should show "archived 5 files, pruned 0 files"
```

**Token rotation:**
```bash
# Check token status
curl -H "Authorization: Bearer <master-token>" http://localhost:18801/mesh/token/status

# Should show ephemeral token with expiry
```

**Queue persistence:**
```bash
# Send test event
echo "test" >> ~/.openclaw/workspace/memory/lcm/2026-04-13.jsonl

# Check queue WAL
ls -l memory/queue/wal/
# Should see new .log file
```

### Step 4: Deprecate Phase 1 Tokens (After 7 Days)

Once all agents are running Phase 2:
1. Remove static tokens from config
2. Restart services (they'll use ephemeral tokens only)
3. Old tokens remain valid for 7 days as fallback
4. After 7 days: revoke old tokens via token service

---

## 6. Implementation Plan

### Week 1: Core Modules
- [ ] `storage-rotation.mjs` — archive, prune, verify
- [ ] `token-service.mjs` — issue, rotate, revoke
- [ ] `queue-persistence.mjs` — WAL, snapshots, SQLite index

### Week 2: Integration
- [ ] Update `memory-relay.mjs` to use queue persistence
- [ ] Update `config.mjs` to support new schema
- [ ] Add token validation to `memory-receiver.mjs`
- [ ] Create `setup.mjs` migration script

### Week 3: Testing & Hardening
- [ ] Stress test: queue persistence under crash/restart
- [ ] Security audit: token service, master token handling
- [ ] Migration test: Phase 1 → Phase 2 on staging environment
- [ ] Documentation: update ARCHITECTURE.md, DEPLOY.md

### Week 4: Rollout
- [ ] Deploy to Liz (primary)
- [ ] Deploy to Ray
- [ ] Deploy to Woodhouse
- [ ] Monitor for 7 days, then deprecate Phase 1 tokens

---

## 7. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Queue WAL grows unbounded | Low | High | Snapshot + WAL rotation every 10MB |
| Token service becomes SPOF | Medium | High | Run as HA systemd service, master token backup |
| Archive corruption | Low | Medium | Verify tar.gz before deleting source |
| Migration fails mid-way | Medium | High | Rollback plan: restore Phase 1 config, restart old services |
| Ephemeral token leaks | Medium | High | Short TTL (24h), auto-rotation, revoke on suspicion |

---

## 8. Success Criteria

Phase 2 is complete when:
- [ ] Storage rotation runs automatically, archives verified
- [ ] Token service issues, rotates, and revokes tokens correctly
- [ ] Queue persists across crash/restart with zero data loss
- [ ] All three agents (Liz, Ray, Woodhouse) migrated successfully
- [ ] Stress test passes with simulated crashes and restarts
- [ ] QA report shows 0 regressions from Phase 1

---

## Authors

- **Liz** — AI partner, Better Machine (@LizSquirrelBot)
- **Erik Ross** — Founder, Better Machine (@Kosfootel)
