# mesh-memory MVP Backend Architecture Specification

**Version:** 1.0  
**Date:** 2026-04-11  
**Status:** Draft / Awaiting Review  
**Author:** Liz (backend-architect subagent)

---

## Executive Summary

This document specifies the production-grade backend architecture for mesh-memory MVP. It addresses critical flaws in the POC implementation: non-atomic writes, lack of fsync durability guarantees, and in-memory state loss on crash. The design ensures **cross-session memory survives the 4 AM hard reset** while supporting multi-agent concurrent access with proper conflict resolution.

---

## 1. Design Principles

### 1.1 Durability First
- All writes are atomic (WAL + temp+rename pattern)
- fsync before acknowledgment
- No in-memory state that must survive a crash

### 1.2 Session Boundary Awareness
- Explicit checkpointing before 4 AM reset
- Recovery/replay on startup
- Clean separation between volatile session state and durable memory

### 1.3 Multi-Agent Safety
- Advisory file locking for concurrent access
- Last-write-wins → merge-based conflict resolution (evolution path)
- Atomic multi-file operations via journal

### 1.4 Performance Hierarchy
- L0 (Identity): ~100 tokens, always in memory, <50ms read
- L1 (Critical facts): ~500-800 tokens, loaded at startup, <100ms read
- L2 (On-demand): Async loaded when specific contexts needed
- L3 (Deep storage): Full semantic search via SQLite/ChromaDB

---

## 2. Data Model

### 2.1 Entity Hierarchy (MemPalace-inspired)

```
Palace (per-agent root)
├── Wing (project/person domain)
│   ├── Room (topic type within wing)
│   │   ├── Closet (AAAK-compressed summary - future)
│   │   └── Drawer (verbatim source text)
│   └── Metadata (access patterns, last sync)
├── Identity (L0 - always loaded)
├── Essential Facts (L1 - loaded at startup)
└── Knowledge Graph (temporal entity relationships)
```

### 2.2 Storage Schema

#### 2.2.1 Core Tables (SQLite)

```sql
-- Schema version tracking
CREATE TABLE schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL,
    description TEXT
);

-- Identity (L0) - single row per agent
CREATE TABLE identity (
    agent_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    creature TEXT,
    emoji TEXT,
    avatar_url TEXT,
    metadata TEXT, -- JSON blob
    updated_at TEXT NOT NULL,
    checksum TEXT -- SHA256 of serialized identity
);

-- Wings (domains)
CREATE TABLE wings (
    id TEXT PRIMARY KEY, -- UUID
    agent_id TEXT NOT NULL,
    name TEXT NOT NULL,
    wing_type TEXT NOT NULL, -- 'project', 'person', 'system'
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    access_count INTEGER DEFAULT 0,
    last_accessed TEXT,
    FOREIGN KEY (agent_id) REFERENCES identity(agent_id)
);

-- Rooms (topics within wings)
CREATE TABLE rooms (
    id TEXT PRIMARY KEY,
    wing_id TEXT NOT NULL,
    name TEXT NOT NULL,
    room_type TEXT NOT NULL, -- 'conversation', 'decision', 'lesson', 'technical'
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    access_count INTEGER DEFAULT 0,
    FOREIGN KEY (wing_id) REFERENCES wings(id)
);

-- Drawers (verbatim memory chunks)
CREATE TABLE drawers (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    content TEXT NOT NULL, -- verbatim text
    content_hash TEXT NOT NULL, -- SHA256 for dedup
    created_at TEXT NOT NULL,
    source_agent TEXT, -- null for own memories
    tags TEXT, -- JSON array
    weight REAL DEFAULT 1.0, -- importance score
    emotions TEXT, -- JSON array of emotion codes
    flags TEXT, -- JSON array: CORE, DECISION, TECHNICAL, etc.
    FOREIGN KEY (room_id) REFERENCES rooms(id)
);

-- Knowledge Graph (temporal facts)
CREATE TABLE facts (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL, -- entity code
    predicate TEXT NOT NULL, -- relationship type
    object TEXT NOT NULL, -- entity or value
    asserted_at TEXT NOT NULL,
    expires_at TEXT, -- null = never expires
    invalidated_at TEXT, -- when superseded
    invalidated_by TEXT, -- fact ID that invalidated this
    source_drawer TEXT, -- provenance
    confidence REAL DEFAULT 1.0,
    FOREIGN KEY (source_drawer) REFERENCES drawers(id)
);

-- Cross-reference index for fast lookup
CREATE INDEX idx_facts_subject ON facts(subject);
CREATE INDEX idx_facts_predicate ON facts(predicate);
CREATE INDEX idx_facts_temporal ON facts(asserted_at, expires_at);

-- Memory access log (for LRU and usage analytics)
CREATE TABLE access_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drawer_id TEXT NOT NULL,
    accessed_at TEXT NOT NULL,
    access_type TEXT NOT NULL, -- 'read', 'search', 'sync'
    FOREIGN KEY (drawer_id) REFERENCES drawers(id)
);

-- Write-Ahead Log entries (for replication/recovery)
CREATE TABLE wal_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sequence_number INTEGER NOT NULL UNIQUE,
    operation TEXT NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE'
    table_name TEXT NOT NULL,
    row_id TEXT NOT NULL,
    payload TEXT NOT NULL, -- JSON of full row
    checksum TEXT NOT NULL, -- SHA256 of payload
    timestamp TEXT NOT NULL,
    synced INTEGER DEFAULT 0 -- replication status
);

CREATE INDEX idx_wal_unsynced ON wal_entries(synced, sequence_number);
```

#### 2.2.2 File Structure

```
~/.openclaw/workspace/memory/
├── mesh-memory.db              -- Main SQLite database
├── mesh-memory.db-wal          -- SQLite WAL file
├── mesh-memory.db-shm          -- SQLite shared memory
├── mesh-memory.checkpoint      -- Last successful checkpoint timestamp
├── wal/                        -- Write-ahead log segments
│   ├── 000000001.wal
│   ├── 000000002.wal
│   └── current
├── journals/                   -- Multi-file operation journals
│   └── [transaction-id].journal
├── l0/                         -- L0 cache (identity.json)
│   └── identity.json
├── l1/                         -- L1 cache (essential facts)
│   └── essential.json
├── backups/                    -- Automatic backups
│   └── daily/
└── locks/                      -- Advisory lock files
    └── mesh-memory.lock
```

---

## 3. Write Path

### 3.1 WAL Pattern (Atomic Writes)

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
   Application       WAL Insert      Apply to DB       Checkpoint         fsync
        │                │                │                │                │
        ▼                ▼                ▼                ▼                ▼
   ┌────────┐      ┌────────┐      ┌────────┐      ┌────────┐      ┌────────┐
   │ Write  │ ──▶  │ Append │ ──▶  │ Update │ ──▶  │ Flush  │ ──▶  │ Sync   │
   │ Request│      │ to WAL │      │ SQLite │      │ WAL to │      │ Files  │
   │        │      │ (txn)  │      │ (txn)  │      │ DB     │      │        │
   └────────┘      └────────┘      └────────┘      └────────┘      └────────┘
        │                │                │                │                │
   Validate       Compute         Commit           Truncate         Return
   + Normalize    Checksum          SQLite           WAL if           success
                                   txn              threshold        to caller
```

### 3.2 Write Operation Flow

```javascript
class MemoryStore {
  async write(entry) {
    // Phase 1: Validate and prepare
    const validated = this.validate(entry);
    const payload = JSON.stringify(validated);
    const checksum = sha256(payload);
    
    // Phase 2: WAL append (atomic)
    const walEntry = await this.wal.append({
      operation: 'INSERT',
      table: 'drawers',
      rowId: validated.id,
      payload,
      checksum,
      timestamp: new Date().toISOString()
    });
    
    // Phase 3: Apply to SQLite (transactional)
    await this.db.transaction(async (trx) => {
      await trx('drawers').insert(validated);
      await trx('wal_entries')
        .where('id', walEntry.id)
        .update({ applied: true });
    });
    
    // Phase 4: Checkpoint if threshold reached
    if (await this.wal.shouldCheckpoint()) {
      await this.checkpoint();
    }
    
    // Phase 5: Sync to disk
    await this.fsync();
    
    return validated;
  }
  
  async checkpoint() {
    // SQLite PRAGMA wal_checkpoint(TRUNCATE)
    await this.db.raw('PRAGMA wal_checkpoint(TRUNCATE)');
    
    // Update checkpoint metadata
    await this.writeCheckpoint({
      timestamp: new Date().toISOString(),
      sequence: await this.wal.getLastSequence()
    });
    
    // fsync checkpoint file
    await this.fsync(this.checkpointPath);
  }
}
```

### 3.3 Multi-File Atomic Operations

For operations spanning multiple tables/files, use journal files:

```javascript
async function atomicMultiWrite(operations) {
  const txId = generateTxId();
  const journalPath = `journals/${txId}.journal`;
  
  // Phase 1: Write journal (prepare)
  await writeFile(journalPath, JSON.stringify({
    txId,
    status: 'PREPARED',
    operations,
    timestamp: new Date().toISOString()
  }));
  await fsync(journalPath);
  
  try {
    // Phase 2: Execute operations
    for (const op of operations) {
      await executeOperation(op);
    }
    
    // Phase 3: Mark complete
    await writeFile(journalPath, JSON.stringify({
      txId,
      status: 'COMMITTED',
      operations,
      completedAt: new Date().toISOString()
    }));
    await fsync(journalPath);
    
  } catch (err) {
    // Phase 3 (failure): Mark aborted
    await writeFile(journalPath, JSON.stringify({
      txId,
      status: 'ABORTED',
      error: err.message,
      abortedAt: new Date().toISOString()
    }));
    throw err;
  }
  
  // Phase 4: Cleanup (async, best effort)
  setTimeout(() => unlink(journalPath).catch(() => {}), 60000);
}
```

---

## 4. Read Path

### 4.1 Tiered Loading Strategy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              READ REQUEST                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
              ┌─────────┐       ┌─────────┐       ┌─────────┐
              │   L0    │       │   L1    │       │   L2+   │
              │Identity │       │Essential│       │ On-Demand
              │  Cache  │       │  Facts  │       │  Load   │
              └────┬────┘       └────┬────┘       └────┬────┘
                   │                 │                 │
              <50ms miss          <100ms miss        Async
                   │                 │                 │
                   └─────────────────┴─────────────────┘
                                     │
                                     ▼
                        ┌────────────────────────┐
                        │    L3 Deep Storage     │
                        │  (SQLite/ChromaDB)     │
                        │   Full semantic search │
                        └────────────────────────┘
```

### 4.2 Implementation

```javascript
class TieredMemory {
  constructor() {
    this.l0 = new L0Cache();      // In-memory Map
    this.l1 = new L1Cache();      // JSON file, loaded at startup
    this.l2 = new L2Loader();     // Async room/wing loader
    this.l3 = new SQLiteBackend(); // Full database
  }
  
  async read(query) {
    // Try L0 (identity) - always in memory
    const identity = this.l0.getIdentity();
    if (query.isIdentityQuery) {
      return { tier: 'L0', data: identity, latency: '50ms' };
    }
    
    // Try L1 (essential facts) - loaded at startup
    const essential = this.l1.search(query);
    if (essential.hits.length > 0) {
      return { tier: 'L1', data: essential, latency: '100ms' };
    }
    
    // Async L2 load if specific wing/room context needed
    if (query.wingId || query.roomId) {
      const l2data = await this.l2.load(query.wingId, query.roomId);
      return { tier: 'L2', data: l2data, latency: 'async' };
    }
    
    // Fall through to L3 (full search)
    const results = await this.l3.search(query);
    return { tier: 'L3', data: results, latency: 'variable' };
  }
  
  async startup() {
    // Load L0 (always)
    this.l0.load(await this.l3.getIdentity());
    
    // Load L1 (async but blocking for startup)
    const essential = await this.l3.getEssentialFacts();
    this.l1.load(essential);
    
    // L2/L3 remain on-demand
  }
}
```

### 4.3 L0 Cache Format (identity.json)

```json
{
  "version": "1.0",
  "agent_id": "liz",
  "name": "Liz",
  "role": "Agent",
  "creature": "Squirrel keeper, pixie, fierce",
  "emoji": "🐿️",
  "vibe": "Sharp, warm, direct",
  "loaded_at": "2026-04-11T21:30:00Z",
  "checksum": "sha256:abc123..."
}
```

### 4.4 L1 Cache Format (essential.json)

```json
{
  "version": "1.0",
  "updated_at": "2026-04-11T21:30:00Z",
  "facts": [
    {
      "id": "fact-001",
      "category": "critical",
      "fact": "Erik Ross is the primary user",
      "weight": 1.0,
      "flags": ["CORE", "IDENTITY"],
      "source": "initialization"
    }
  ],
  "checksum": "sha256:def456..."
}
```

---

## 5. Recovery Procedure

### 5.1 Startup Recovery Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        STARTUP                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │ Check for       │
                    │ journal files   │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
         Journals      No journals    DB corrupt
         found?           found         / missing
              │              │              │
              ▼              ▼              ▼
    ┌─────────────────┐   │       ┌─────────────────┐
    │ Replay journals │   │       │ Restore from    │
    │ (redo/undo)     │   │       │ last backup     │
    └────────┬────────┘   │       └────────┬────────┘
             │            │                │
             └────────────┴────────────────┘
                          │
                          ▼
                 ┌─────────────────┐
                 │ Open SQLite     │
                 │ with WAL mode   │
                 └────────┬────────┘
                          │
                          ▼
                 ┌─────────────────┐
                 │ Check WAL       │
                 │ consistency     │
                 └────────┬────────┘
                          │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         WAL OK       WAL needs    WAL corrupt
                      checkpoint
              │            │            │
              ▼            ▼            ▼
    ┌─────────────────┐  │     ┌─────────────────┐
    │ Continue to     │  │     │ Truncate WAL    │
    │ normal startup  │  │     │ and restore     │
    └─────────────────┘  │     └─────────────────┘
                          │
                          ▼
                 ┌─────────────────┐
                 │ PRAGMA          │
                 │ wal_checkpoint  │
                 └─────────────────┘
```

### 5.2 Recovery Implementation

```javascript
class RecoveryManager {
  async startup() {
    // Step 1: Check for incomplete transactions
    const journals = await this.listJournalFiles();
    for (const journal of journals) {
      await this.replayJournal(journal);
    }
    
    // Step 2: Open database
    let db = await this.openDatabase();
    
    // Step 3: Check WAL integrity
    const walStatus = await this.checkWAL(db);
    if (walStatus.corrupt) {
      await this.restoreFromBackup();
      db = await this.openDatabase();
    } else if (walStatus.needsCheckpoint) {
      await db.raw('PRAGMA wal_checkpoint(TRUNCATE)');
    }
    
    // Step 4: Verify schema version
    await this.migrateIfNeeded(db);
    
    // Step 5: Load L0/L1 caches
    await this.loadCaches(db);
    
    return db;
  }
  
  async replayJournal(journalPath) {
    const journal = JSON.parse(await readFile(journalPath));
    
    switch (journal.status) {
      case 'PREPARED':
        // Transaction was prepared but never committed - roll back
        await this.rollbackOperations(journal.operations);
        break;
      case 'COMMITTED':
        // Transaction completed - verify, then cleanup
        await this.verifyOperations(journal.operations);
        await unlink(journalPath);
        break;
      case 'ABORTED':
        // Transaction aborted - cleanup
        await unlink(journalPath);
        break;
    }
  }
}
```

---

## 6. Concurrency Model

### 6.1 Advisory Locking Strategy

```javascript
class FileLockManager {
  constructor() {
    this.lockDir = '~/.openclaw/workspace/memory/locks/';
  }
  
  async acquireLock(resource, mode = 'exclusive') {
    const lockFile = `${this.lockDir}${resource}.lock`;
    const lockData = {
      pid: process.pid,
      agent: this.agentId,
      mode,
      acquiredAt: new Date().toISOString()
    };
    
    // Try to create lock file atomically
    try {
      await writeFile(lockFile, JSON.stringify(lockData), { flag: 'wx' });
      return { success: true, lockFile };
    } catch (err) {
      if (err.code === 'EEXIST') {
        // Lock exists - check if stale
        const existing = await this.readLock(lockFile);
        if (await this.isStale(existing)) {
          await this.breakLock(lockFile);
          return this.acquireLock(resource, mode);
        }
        return { success: false, reason: 'locked', holder: existing };
      }
      throw err;
    }
  }
  
  async releaseLock(lockFile) {
    await unlink(lockFile).catch(() => {});
  }
  
  async withLock(resource, mode, fn) {
    const lock = await this.acquireLock(resource, mode);
    if (!lock.success) {
      throw new Error(`Could not acquire lock for ${resource}: ${lock.reason}`);
    }
    try {
      return await fn();
    } finally {
      await this.releaseLock(lock.lockFile);
    }
  }
}
```

### 6.2 Conflict Resolution

**Phase 1 (MVP): Last-Write-Wins**
```javascript
async function writeWithLWW(table, id, data) {
  const existing = await db(table).where({ id }).first();
  if (existing) {
    if (new Date(data.updated_at) > new Date(existing.updated_at)) {
      await db(table).where({ id }).update(data);
    } else {
      throw new Error('Conflict: newer version exists');
    }
  } else {
    await db(table).insert(data);
  }
}
```

**Phase 2 (Future): Merge-Based**
```javascript
async function writeWithMerge(table, id, data) {
  const existing = await db(table).where({ id }).first();
  if (existing) {
    const merged = await mergeStrategy(existing, data);
    await db(table).where({ id }).update(merged);
  } else {
    await db(table).insert(data);
  }
}
```

---

## 7. Schema Evolution

### 7.1 Migration Framework

```javascript
class SchemaMigrator {
  constructor() {
    this.migrations = new Map();
    this.registerMigrations();
  }
  
  registerMigrations() {
    // Migration: 0 -> 1 (Initial schema)
    this.migrations.set(1, async (db) => {
      await db.raw(`
        CREATE TABLE schema_version (...);
        CREATE TABLE identity (...);
        -- ... etc
      `);
    });
    
    // Migration: 1 -> 2 (Add knowledge graph)
    this.migrations.set(2, async (db) => {
      await db.raw(`
        CREATE TABLE facts (...);
        CREATE INDEX idx_facts_subject ON facts(subject);
      `);
    });
    
    // Migration: 2 -> 3 (Add access log)
    this.migrations.set(3, async (db) => {
      await db.raw(`
        CREATE TABLE access_log (...);
      `);
    });
  }
  
  async migrate(db) {
    const currentVersion = await this.getCurrentVersion(db);
    const targetVersion = Math.max(...this.migrations.keys());
    
    for (let v = currentVersion + 1; v <= targetVersion; v++) {
      const migration = this.migrations.get(v);
      if (migration) {
        await db.transaction(async (trx) => {
          await migration(trx);
          await trx('schema_version').insert({
            version: v,
            applied_at: new Date().toISOString()
          });
        });
      }
    }
  }
}
```

---

## 8. Session Boundary Handling

### 8.1 Pre-Reset Checkpoint Protocol

```javascript
class SessionManager {
  async handlePreReset() {
    // Called before 4 AM hard reset
    console.log('[session] Pre-reset checkpoint starting...');
    
    // 1. Flush all pending writes
    await this.store.checkpoint();
    
    // 2. Write session summary to L1
    await this.store.writeSessionSummary({
      sessionId: this.sessionId,
      startTime: this.sessionStart,
      endTime: new Date().toISOString(),
      keyEvents: this.eventBuffer,
      decisions: this.decisionBuffer
    });
    
    // 3. Mark checkpoint complete
    await this.store.writeCheckpoint({
      type: 'session_boundary',
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId
    });
    
    // 4. Sync to disk
    await this.store.fsync();
    
    console.log('[session] Pre-reset checkpoint complete');
  }
  
  async startup() {
    // Check for previous session checkpoint
    const lastCheckpoint = await this.store.readCheckpoint();
    
    if (lastCheckpoint && lastCheckpoint.type === 'session_boundary') {
      console.log(`[session] Resuming from checkpoint: ${lastCheckpoint.sessionId}`);
      await this.store.replayWALSince(lastCheckpoint.timestamp);
    }
    
    // Initialize new session
    this.sessionId = generateSessionId();
    this.sessionStart = new Date().toISOString();
  }
}
```

---

## 9. Performance Targets

| Operation | Target | Measurement |
|-----------|--------|-------------|
| L0 Read (identity) | <50ms | Time to return identity object |
| L1 Read (essential facts) | <100ms | Time to search and return results |
| L2 Load (room context) | <500ms | Time to load specific wing/room |
| L3 Search | <2s | Full semantic search |
| Write Latency | <100ms | Single entry write + fsync |
| Checkpoint | <1s | WAL checkpoint operation |
| Recovery | <5s | Startup with replay |

---

## 10. Implementation Phases

### Phase 1: Foundation (Week 1-2)
- [ ] SQLite schema implementation
- [ ] WAL pattern for atomic writes
- [ ] fsync guarantees
- [ ] Basic L0/L1 cache
- [ ] Recovery procedure

### Phase 2: Multi-Agent Safety (Week 3-4)
- [ ] Advisory file locking
- [ ] Last-write-wins conflict resolution
- [ ] Multi-file operation journals
- [ ] Concurrent access tests

### Phase 3: Session Boundaries (Week 5-6)
- [ ] Pre-reset checkpoint protocol
- [ ] Session recovery
- [ ] 4 AM hard reset handling
- [ ] Cross-session durability tests

### Phase 4: Performance (Week 7-8)
- [ ] L2 async loading
- [ ] Access logging
- [ ] LRU eviction
- [ ] Performance benchmarks

### Phase 5: Knowledge Graph (Week 9-10)
- [ ] Temporal fact storage
- [ ] Fact invalidation
- [ ] Entity relationship queries
- [ ] AAAK compression integration

---

## 11. References

- [MemPalace Analysis](./MEMPALACE-ANALYSIS.md) - Hierarchy and AAAK inspiration
- [Current Architecture](./ARCHITECTURE.md) - Existing mesh-memory design
- [SQLite WAL Mode](https://sqlite.org/wal.html) - Write-Ahead Logging
- [AGENTS.md](../../../AGENTS.md) - Session boundary requirements

---

## Appendix A: Database Configuration

```sql
-- Recommended SQLite pragmas for durability
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA wal_autocheckpoint = 1000;
PRAGMA cache_size = -64000; -- 64MB cache
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 30000000000; -- 30GB mmap if supported
```

## Appendix B: Backup Strategy

```javascript
async function createBackup() {
  const backupPath = `backups/daily/${new Date().toISOString().slice(0, 10)}.db`;
  await db.raw(`VACUUM INTO '${backupPath}'`);
  
  // Keep only last 7 daily backups
  await pruneOldBackups(7);
}
```

---

*End of Specification*
