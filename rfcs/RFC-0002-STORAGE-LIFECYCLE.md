# RFC-0002: Storage Lifecycle and Durability Guarantees

**Status:** Draft  
**Author(s):** Liz (coordinated by), backend-architect, database-engineer  
**Created:** 2026-04-11  
**Last Updated:** 2026-04-11

---

## Summary

This RFC proposes replacing mesh-memory's file-based JSON persistence with SQLite + WAL mode, implementing atomic writes, fsync durability guarantees, and a checkpoint/recovery protocol for the 4 AM hard reset boundary. The current POC loses data on crash due to non-atomic writes and OS buffer loss.

---

## Motivation

Current mesh-memory persistence (`shared-pool-write.mjs`, `memory-bridge.mjs`, etc.) has critical flaws:

1. **Non-atomic writes:** `writeFile(poolPath, JSON.stringify(pool))` truncates file on crash
2. **No fsync:** Data acknowledged to clients may sit in OS buffers, lost on power failure
3. **Silent corruption:** `try/catch` on parse returns empty array, data lost without indication
4. **No recovery:** Corrupt files have no backup or WAL replay mechanism
5. **4 AM reset kills in-memory state:** Session-scoped Maps (privacy mode, relay queues) vanish

Without this RFC, cross-session memory cannot be trusted. The 4 AM hard reset is a guaranteed data loss event.

---

## Prior Art / Existing Approaches

### SQLite + WAL Mode
- **Relevant:** Battle-tested embedded database with ACID guarantees
- **Approach:** Write-Ahead Logging for durability, fsync on commit
- **Trade-off:** SQL interface adds complexity vs. raw JSON files

### Append-Only Log (Event Sourcing)
- **Relevant:** Immutability guarantees, easy replay
- **Approach:** All writes append to log, snapshots for fast recovery
- **Trade-off:** Log compaction/compression needed, query complexity

### LevelDB/RocksDB
- **Relevant:** LSM-tree for high write throughput
- **Approach:** Sorted key-value with compaction
- **Trade-off:** Overkill for current scale, adds dependency

### Our Current POC
- Direct JSON file writes with read-modify-write pattern
- No journaling, no backup, no schema validation
- Files: `pool.json`, `sync-state.json`, `cursor.json`, `tokens.json`

**Decision:** MVP adopts SQLite + WAL mode for atomicity and durability. Append-only log considered for Phase 2 high-throughput scenarios.

---

## Detailed Design

### Storage Engine: SQLite + WAL Mode

```sql
-- Core tables
CREATE TABLE memory_entries (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  type TEXT NOT NULL,  -- 'fact', 'interpretation', 'decision', 'lesson'
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,  -- Unix milliseconds
  expires_at INTEGER,            -- NULL for permanent
  checksum TEXT NOT NULL         -- SHA-256 of content
);

CREATE TABLE sync_cursors (
  peer_id TEXT PRIMARY KEY,
  last_entry_id TEXT NOT NULL,
  last_sync_at INTEGER NOT NULL,
  FOREIGN KEY (last_entry_id) REFERENCES memory_entries(id)
);

CREATE TABLE session_state (
  key TEXT PRIMARY KEY,   -- 'privacy_mode', 'relay_queue', etc.
  value TEXT NOT NULL,    -- JSON blob
  updated_at INTEGER NOT NULL
);

CREATE TABLE checkpoints (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  entry_count INTEGER NOT NULL,
  wal_offset INTEGER NOT NULL
);

-- Indexes
CREATE INDEX idx_entries_agent ON memory_entries(agent_id, created_at);
CREATE INDEX idx_entries_type ON memory_entries(type, created_at);
CREATE INDEX idx_entries_expires ON memory_entries(expires_at) WHERE expires_at IS NOT NULL;
```

### Write Path (Durability Guaranteed)

```javascript
async function writeEntry(entry) {
  // 1. Validate and compute checksum
  const checksum = sha256(entry.content);
  
  // 2. Start transaction
  const tx = await db.beginTransaction();
  
  try {
    // 3. Insert with conflict resolution (idempotent)
    await tx.run(`
      INSERT INTO memory_entries (id, agent_id, type, content, created_at, checksum)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content,
        checksum = excluded.checksum
        WHERE memory_entries.checksum != excluded.checksum
    `, [entry.id, entry.agentId, entry.type, entry.content, Date.now(), checksum]);
    
    // 4. Update cursor if this is a sync write
    if (entry.syncPeer) {
      await tx.run(`
        INSERT INTO sync_cursors (peer_id, last_entry_id, last_sync_at)
        VALUES (?, ?, ?)
        ON CONFLICT(peer_id) DO UPDATE SET
          last_entry_id = excluded.last_entry_id,
          last_sync_at = excluded.last_sync_at
      `, [entry.syncPeer, entry.id, Date.now()]);
    }
    
    // 5. Commit with fsync
    await tx.commit();  // PRAGMA synchronous = FULL ensures fsync
    
    // 6. Return receipt
    return {
      id: entry.id,
      confirmedAt: new Date().toISOString(),
      checksum
    };
    
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}
```

### Checkpoint Protocol (4 AM Hard Reset)

```javascript
// Runs 5 minutes before scheduled reset
async function checkpointSession() {
  const checkpointId = `cp-${Date.now()}`;
  
  // 1. Serialize in-memory state
  const sessionState = {
    privacy_mode: getPrivacyModeMap(),  // Convert Map to JSON
    relay_queues: getRelayQueues(),
    pending_syncs: getPendingSyncs()
  };
  
  // 2. Write to SQLite in single transaction
  await db.run(`
    INSERT INTO session_state (key, value, updated_at)
    VALUES 
      ('privacy_mode', ?, ?),
      ('relay_queues', ?, ?),
      ('pending_syncs', ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `, [
    JSON.stringify(sessionState.privacy_mode), Date.now(),
    JSON.stringify(sessionState.relay_queues), Date.now(),
    JSON.stringify(sessionState.pending_syncs), Date.now()
  ]);
  
  // 3. Force WAL checkpoint
  await db.run('PRAGMA wal_checkpoint(TRUNCATE)');
  
  // 4. Record checkpoint metadata
  await db.run(`
    INSERT INTO checkpoints (id, created_at, entry_count, wal_offset)
    VALUES (?, ?, (SELECT COUNT(*) FROM memory_entries), ?)
  `, [checkpointId, Date.now(), await getWalOffset()]);
  
  return checkpointId;
}

// Runs on session startup
async function restoreSession() {
  // 1. Load session state
  const rows = await db.all('SELECT key, value FROM session_state');
  const state = Object.fromEntries(rows.map(r => [r.key, JSON.parse(r.value)]));
  
  // 2. Restore Maps
  restorePrivacyMode(state.privacy_mode || {});
  restoreRelayQueues(state.relay_queues || {});
  restorePendingSyncs(state.pending_syncs || {});
  
  // 3. Verify integrity
  const lastCheckpoint = await db.get(
    'SELECT * FROM checkpoints ORDER BY created_at DESC LIMIT 1'
  );
  
  const actualCount = await db.get('SELECT COUNT(*) as count FROM memory_entries');
  if (actualCount.count !== lastCheckpoint.entry_count) {
    console.warn(`[restore] Entry count mismatch: ${actualCount.count} vs ${lastCheckpoint.entry_count}`);
    // Trigger repair/validation
  }
}
```

### Read Path (Tiered Loading)

```javascript
// L0: Identity (~100 tokens) - always hot
const L0_CACHE = new Map();  // Never expires

// L1: Critical facts (~500-800 tokens) - hot with TTL
const L1_CACHE = new Map();  // 5-minute TTL

// L2: Deep memory - loaded on demand
async function queryMemory(agentId, options = {}) {
  const { type, since, limit = 100, consistency = 'eventual' } = options;
  
  // L0/L1 cache check
  const cacheKey = `${agentId}:${type}:${since}`;
  if (L1_CACHE.has(cacheKey)) {
    return L1_CACHE.get(cacheKey);
  }
  
  // Strong consistency: fsync before read
  if (consistency === 'strong') {
    await db.run('PRAGMA wal_checkpoint(PASSIVE)');
  }
  
  // Query with index
  const entries = await db.all(`
    SELECT id, agent_id, type, content, created_at, checksum
    FROM memory_entries
    WHERE agent_id = ? AND type = ? AND created_at > ?
    ORDER BY created_at DESC
    LIMIT ?
  `, [agentId, type, since || 0, limit]);
  
  // Verify checksums
  for (const entry of entries) {
    const computed = sha256(entry.content);
    if (computed !== entry.checksum) {
      throw new Error(`Checksum mismatch for entry ${entry.id}`);
    }
  }
  
  // Populate cache
  L1_CACHE.set(cacheKey, entries);
  
  return entries;
}
```

### Pruning and Rotation

```javascript
// Daily cleanup job
async function pruneExpiredEntries() {
  const deleted = await db.run(`
    DELETE FROM memory_entries
    WHERE expires_at IS NOT NULL
      AND expires_at < ?
  `, [Date.now()]);
  
  console.log(`[prune] Removed ${deleted.changes} expired entries`);
  
  // Vacuum to reclaim space
  await db.run('VACUUM');
}

// Weekly backup
async function createBackup() {
  const backupPath = `${DB_PATH}.backup.${Date.now()}`;
  await db.run(`VACUUM INTO '${backupPath}'`);
  return backupPath;
}
```

---

## Alternatives Considered

| Alternative | Why Considered | Why Rejected |
|-------------|---------------|--------------|
| Keep JSON + add WAL layer | Minimal change | Reinventing SQLite |
| PostgreSQL | Full SQL power | Requires separate service, overkill for embedded |
| Append-only log (LevelDB) | Immutability | Query complexity, compaction overhead |
| Flat files with fsync only | Simplicity | Still non-atomic on crash |
| Distributed storage (IPFS) | Decentralization | Too complex for MVP, latency issues |

---

## Impact Assessment

### Breaking Changes
- [x] **Breaking change** — All existing JSON files must be migrated
- **Migration path:**
  1. Create SQLite schema alongside existing files
  2. Import existing JSON data with validation
  3. Run parallel for 7 days, verify consistency
  4. Remove JSON file code paths

### Affected Components
- `shared-pool-write.mjs` — Replace with SQLite writes
- `shared-pool-read.mjs` — Replace with SQLite queries
- `shared-pool-sync.mjs` — Cursor storage in SQLite
- `memory-bridge.mjs` — Cursor and export tracking in SQLite
- `memory-receiver.mjs` — All persistence via SQLite
- `thread-context.mjs` — Thread state in SQLite
- `blind-gate.mjs` — Gate storage in SQLite
- `privacy.mjs` — Session state checkpointing
- `memory-relay.mjs` — Queue persistence in SQLite

### Security Considerations
- Database file permissions: 0600
- Checksums on all entries detect tampering
- WAL files encrypted at rest (Phase 2)

### Performance Considerations
- SQLite with WAL mode: ~50μs writes (fsync every transaction)
- Query with index: ~1ms for 1000 entries
- Backup (VACUUM INTO): ~1 second per 100MB
- L0/L1 caching reduces DB queries by ~80%

### Twelve-Factor Considerations
- SQLite is a backing service (state externalized)
- Schema migrations versioned with code
- Database path configurable via environment

---

## Open Questions

1. Should we use `PRAGMA synchronous = FULL` or `EXTRA`? (FULL = fsync per commit, EXTRA = fsync + sync parent dir)
2. What's the retention policy? 30 days? 90 days? Forever?
3. Should expired entries be soft-deleted (archived) or hard-deleted?
4. What's the backup strategy? Daily? Weekly? Incremental?

---

## Review Checklist

Before Draft → Under Review:
- [x] Prior art section complete
- [x] At least one concrete example provided
- [x] Alternatives considered section complete
- [x] Breaking changes explicitly called out
- [x] Security considerations addressed

Before Under Review → Accepted:
- [ ] All three agents review and comment
- [ ] Erik approves
- [ ] Open questions resolved
- [ ] Migration plan validated on test data

---

## Decision

**Decision:** [Pending]  
**Decision date:** [Pending]  
**Decided by:** [Pending]

---

## Implementation Notes

*To be filled after acceptance.*
