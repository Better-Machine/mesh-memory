# Mesh-Memory MVP API Implementation Guide

**Status:** Draft (RFC-0000 companion)  
**Author:** Liz (api-tester agency agent)  
**Date:** 2026-04-11  
**Version:** 1.0.0-mvp

---

## Overview

This document provides the implementation details for the production-grade MVP API defined in `MESH_MEMORY_MVP_API.yaml`. It addresses the specific flaws in the current L1/L2 endpoints:

1. **Health lies** → Storage layer actually verified
2. **Write ack ≠ durability** → fsync confirmed before ack
3. **Auth impersonation** → Cryptographic token binding to agent identity

---

## Endpoint Summary

| Category | Endpoint | Method | Purpose |
|----------|----------|--------|---------|
| Health | `/health` | GET | Storage-aware liveness |
| Health | `/health/ready` | GET | Readiness probe |
| Write | `/v1/memory` | POST | Single entry write |
| Write | `/v1/memory/batch` | POST | Batch write |
| Read | `/v1/memory` | GET | Query with pagination |
| Read | `/v1/memory/{id}` | GET | Single entry fetch |
| Sync | `/v1/sync` | POST | Initiate peer sync |
| Sync | `/v1/sync/ack` | POST | Acknowledge receipts |
| Shared Pool | `/v1/shared-pool` | POST/GET | Bias-resistant facts |
| Blind Gate | `/v1/shared/gates` | POST/GET | Commitment protocol |

---

## 1. Health Endpoints

### 1.1 Storage Verification Contract

**Current flaw:** The existing `/health` only checks process liveness. Storage could be full or unreachable and health would return `200 OK`.

**MVP fix:** `/health` performs actual storage checks:

```javascript
// health-check.mjs - Pseudocode

async function healthCheck() {
  const checks = {
    process: true,  // We got here, so process is alive
    storage: await verifyStorage(),
    checkpoint: await getLastCheckpoint()
  };
  
  const isHealthy = checks.storage.ok && 
                    checks.checkpoint.lagMs < 300000; // 5 min max
  
  return {
    status: isHealthy ? "ok" : "degraded",
    storage: {
      state: checks.storage.state,  // "ok" | "disk_full" | "permission_denied"
      path: STORAGE_PATH,
      availableBytes: checks.storage.freeBytes,
      lastCheckpoint: checks.checkpoint.timestamp,
      checkpointLagMs: checks.checkpoint.lagMs
    }
  };
}

async function verifyStorage() {
  try {
    // Write a test file and fsync
    const testPath = `${STORAGE_PATH}/.health-check-${Date.now()}`;
    await fs.writeFile(testPath, "ok");
    await fsync(testPath);  // Actually sync to disk!
    await fs.unlink(testPath);
    
    // Check available space
    const stats = await fs.statfs(STORAGE_PATH);
    const freeBytes = stats.bavail * stats.bsize;
    
    if (freeBytes < 100 * 1024 * 1024) {  // 100MB
      return { ok: false, state: "disk_full", freeBytes };
    }
    
    return { ok: true, state: "ok", freeBytes };
  } catch (err) {
    if (err.code === "EACCES") {
      return { ok: false, state: "permission_denied", freeBytes: 0 };
    }
    return { ok: false, state: "unreachable", freeBytes: 0 };
  }
}
```

### 1.2 Response State Machine

| Storage State | HTTP Status | Meaning |
|---------------|-------------|---------|
| `ok` | 200 | Fully operational |
| `disk_full` | 503 | Writes will fail |
| `permission_denied` | 503 | Permission issue |
| `unreachable` | 503 | Cannot access storage path |

---

## 2. Write Endpoints

### 2.1 Durability Contract

**Current flaw:** Write returns `200 OK` before data hits disk. Crash after ack = lost data.

**MVP fix:** Ack only after fsync:

```javascript
// write-endpoint.mjs - Pseudocode

async function writeMemoryEntry(req, res) {
  const entry = validateEntry(req.body);
  
  // 1. Verify identity binding
  const tokenAgentId = verifyToken(req.headers.authorization);
  if (tokenAgentId !== entry.agentId) {
    return res.status(403).json({
      error: "identity_mismatch",
      message: `Token for '${tokenAgentId}' cannot write entry for '${entry.agentId}'`
    });
  }
  
  // 2. Check idempotency
  const existingReceipt = await checkIdempotency(entry.idempotencyKey);
  if (existingReceipt) {
    return res.status(200).json({  // Not 201, it's a duplicate
      ...existingReceipt,
      duplicate: true
    });
  }
  
  // 3. Generate receipt BEFORE write
  const receipt = {
    receiptId: generateReceiptId(),
    entryId: generateEntryId(),
    timestamp: new Date().toISOString(),
    checksum: computeChecksum(entry),
    confirmedNodes: [NODE_ID]
  };
  
  // 4. Write to WAL first (write-ahead log)
  const walEntry = { entry, receipt, state: "pending" };
  await appendToWAL(walEntry);
  await fsyncWAL();  // CRITICAL: Sync WAL before proceeding
  
  // 5. Write to actual storage
  const storagePath = getStoragePath(entry.timestamp);
  await mkdirp(dirname(storagePath));
  await fs.appendFile(storagePath, formatEntry(entry, receipt));
  await fsync(storagePath);  // CRITICAL: Actually sync to disk
  
  // 6. Mark WAL entry as committed
  await markWALCommitted(walEntry.id);
  
  // 7. Return receipt (now guaranteed durable)
  res.status(201).json(receipt);
}

async function fsync(filePath) {
  const fd = await fs.open(filePath, 'r+');
  await fd.sync();  // POSIX fsync
  await fd.close();
}
```

### 2.2 Idempotency Guarantee

**Idempotency Key Format:**
```
{agentId}-{timestamp}-{type}-{sequence}
```

Examples:
- `liz-2026-04-11-pref-001`
- `ray-2026-04-11-lesson-042`

**Storage:** Idempotency keys are stored in a Bloom filter for O(1) lookups with minimal memory. Full key-to-receipt mapping is stored on disk.

### 2.3 Receipt Schema

```javascript
const receiptSchema = {
  receiptId: "rec_{hash}",       // Global unique ID
  entryId: "ent_{hash}",         // Content-addressed
  timestamp: "ISO8601",          // fsync completion time
  checksum: "sha256:{hash}",      // Canonicalized entry hash
  confirmedNodes: ["liz"],       // Nodes with confirmed fsync
  durability: "fsync_confirmed"   // Promise level
};
```

---

## 3. Read Endpoints

### 3.1 Consistency Model

**Eventual Consistency (Default):**
- Read from local view immediately
- May miss very recent writes from other nodes
- Best for high-throughput queries
- Latency: ~10ms

**Strong Consistency:**
- Wait for all pending writes to sync
- Ensures freshest data
- Latency: ~100-5000ms (depends on sync)

```javascript
// read-endpoint.mjs - Pseudocode

async function queryMemory(req, res) {
  const { consistency = "eventual" } = req.query;
  
  if (consistency === "strong") {
    // 1. Flush local pending writes
    await flushWriteBuffer();
    
    // 2. Request sync from peers (async, with timeout)
    await Promise.race([
      syncFromPeers(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error("sync_timeout")), 5000)
      )
    ]).catch(() => {
      // Timeout is okay, continue with local view
      console.warn("Strong consistency sync timed out, using local view");
    });
  }
  
  // 3. Query local storage
  const results = await queryLocalStorage(req.query);
  
  res.json({
    entries: results.entries,
    nextCursor: results.nextCursor,
    hasMore: results.hasMore,
    consistency: consistency,
    queryTimeMs: results.elapsedMs
  });
}
```

### 3.2 Cursor-Based Pagination

**Cursor Format:** Base64-encoded JSON
```json
{
  "timestamp": "2026-04-11T20:43:00Z",
  "entryId": "ent_lastSeenId",
  "direction": "forward"
}
```

**Why cursor over offset?**
- Stable under concurrent writes
- O(log n) lookup vs O(n) offset
- Works with time-series storage

---

## 4. Auth/Security

### 4.1 Token Binding (MVP Implementation)

**Current flaw:** Random hex tokens can be stolen and used by anyone.

**MVP fix:** JWT-like structured tokens with identity binding:

```javascript
// token-structure.mjs

const tokenStructure = {
  // Header
  alg: "EdDSA",           // Ed25519 signatures (fast, secure)
  typ: "mesh+jwt",
  kid: "key-2026-04-11",  // Key ID for rotation
  
  // Payload
  sub: "liz",             // Agent ID (MUST match request)
  iss: "liz-node",        // Issuing node
  iat: 1712869380,        // Issued at
  exp: 1712955780,        // Expires (24h max)
  
  // Mesh-specific claims
  mesh: {
    nodeId: "node_abc123",
    capabilities: ["read", "write", "sync"],
    rateLimit: 1000       // requests per hour
  }
};

// Verification
function verifyToken(token, requestAgentId) {
  const decoded = jwtDecode(token);
  
  // 1. Check signature
  if (!ed25519Verify(token, decoded.kid)) {
    throw new Error("invalid_signature");
  }
  
  // 2. Check expiration
  if (Date.now() / 1000 > decoded.exp) {
    throw new Error("token_expired");
  }
  
  // 3. Identity binding: token must match request
  if (decoded.sub !== requestAgentId) {
    throw new Error("identity_mismatch");
  }
  
  return decoded.sub;
}
```

**MVP Simplification:** For MVP, use HMAC-SHA256 with shared secrets between nodes:

```javascript
// mvp-token.mjs - Simplified for MVP

const SHARED_SECRET = process.env.MESH_SHARED_SECRET;  // Rotated via config

function generateToken(agentId) {
  const payload = {
    sub: agentId,
    iss: NODE_ID,
    iat: Date.now(),
    exp: Date.now() + 24 * 60 * 60 * 1000
  };
  
  return jwtSign(payload, SHARED_SECRET, { algorithm: "HS256" });
}

function verifyToken(token) {
  return jwtVerify(token, SHARED_SECRET);
}
```

### 4.2 Cannot Write As Another Agent

**Enforcement point:** Every write endpoint validates `token.sub === body.agentId`:

```javascript
// identity-check.mjs

function enforceIdentityBinding(token, requestedAgentId) {
  const tokenAgentId = verifyToken(token).sub;
  
  if (tokenAgentId !== requestedAgentId) {
    // SECURITY: Log this as potential impersonation attempt
    securityLog.warn({
      event: "identity_binding_violation",
      tokenAgent: tokenAgentId,
      requestedAgent: requestedAgentId,
      ip: req.ip,
      timestamp: new Date().toISOString()
    });
    
    throw new Error("identity_mismatch");
  }
  
  return tokenAgentId;
}
```

---

## 5. Sync Endpoints

### 5.1 Cursor-Based Sync

**Problem:** Full sync is expensive. Need incremental sync with resume capability.

**Solution:** Time-based cursors with vector clock tracking:

```javascript
// sync-endpoint.mjs - Pseudocode

async function initiateSync(req, res) {
  const { since, cursor, batchSize = 100 } = req.body;
  
  // 1. Decode cursor (or build from `since`)
  const syncCursor = cursor 
    ? decodeCursor(cursor)
    : { timestamp: since, vectorClock: {} };
  
  // 2. Query local entries since cursor
  const entries = await querySince(syncCursor, batchSize);
  
  // 3. Detect conflicts (entries with same logical time)
  const conflicts = detectConflicts(entries);
  
  // 4. Resolve conflicts
  const { resolved, unresolved } = resolveConflicts(entries, conflicts);
  
  // 5. Build next cursor
  const nextCursor = entries.length > 0
    ? encodeCursor({
        timestamp: entries[entries.length - 1].timestamp,
        vectorClock: updateVectorClock(syncCursor.vectorClock, entries)
      })
    : null;
  
  res.json({
    entries: resolved,
    nextCursor,
    hasMore: entries.length === batchSize,
    conflicts: unresolved
  });
}

function detectConflicts(entries) {
  const byLogicalTime = new Map();
  const conflicts = [];
  
  for (const entry of entries) {
    const key = `${entry.timestamp}-${entry.agentId}`;
    if (byLogicalTime.has(key)) {
      conflicts.push({
        entryId: entry.id,
        conflictingWith: byLogicalTime.get(key)
      });
    } else {
      byLogicalTime.set(key, entry.id);
    }
  }
  
  return conflicts;
}
```

### 5.2 Conflict Resolution

**Policy:** For MVP, use "last-write-wins with preservation":

1. Compare receipt timestamps
2. If same, compare agentId lexicographically
3. Never delete: conflicting entries both kept with conflict markers

```javascript
// conflict-resolution.mjs

function resolveConflict(entryA, entryB) {
  const timeA = new Date(entryA.receipt.timestamp).getTime();
  const timeB = new Date(entryB.receipt.timestamp).getTime();
  
  // Deterministic ordering
  let winner, loser;
  if (timeA !== timeB) {
    winner = timeA > timeB ? entryA : entryB;
    loser = timeA > timeB ? entryB : entryA;
  } else {
    winner = entryA.agentId > entryB.agentId ? entryA : entryB;
    loser = entryA.agentId > entryB.agentId ? entryB : entryA;
  }
  
  return {
    ...winner,
    conflictInfo: {
      hasConflict: true,
      alternateVersion: {
        agentId: loser.agentId,
        content: loser.content,
        timestamp: loser.timestamp,
        receiptId: loser.receipt.receiptId
      },
      resolution: "last_write_wins"
    }
  };
}
```

### 5.3 Acknowledgment

**Purpose:** Allow peers to garbage collect or advance cursors.

```javascript
// sync-ack.mjs - Pseudocode

async function acknowledgeSync(req, res) {
  const { syncId, receipts } = req.body;
  
  // Store acknowledgment
  await db.syncAcks.insert({
    syncId,
    peerAgentId: req.agentId,
    receipts,
    acknowledgedAt: new Date()
  });
  
  // Update peer's position in our sync tracking
  await updatePeerSyncPosition(req.agentId, receipts);
  
  res.json({
    ackId: generateAckId(),
    acknowledgedCount: receipts.length
  });
}
```

---

## 6. Retry/Backoff Contract

### 6.1 Error Categories

| HTTP Status | Category | Retry Strategy |
|-------------|----------|----------------|
| 429 | Rate limited | Exponential: 100ms, 200ms, 400ms, 800ms, 1.6s |
| 503 | Unavailable | Exponential + jitter: base 1s, max 30s |
| 5xx | Server error | Linear: 1s, 2s, 3s, 5s, then fail |
| 409 | Conflict | Immediate retry with merged payload |
| 400, 403, 404 | Client error | **No retry** — fix the request |

### 6.2 Client Implementation

```javascript
// retry-client.mjs

class MeshMemoryClient {
  async requestWithRetry(method, path, body, options = {}) {
    const maxRetries = options.maxRetries || 5;
    let attempt = 0;
    
    while (attempt < maxRetries) {
      try {
        const response = await this.request(method, path, body);
        return response;
      } catch (error) {
        attempt++;
        
        if (!this.isRetryable(error) || attempt >= maxRetries) {
          throw error;
        }
        
        const delay = this.calculateBackoff(error, attempt);
        await sleep(delay);
      }
    }
  }
  
  isRetryable(error) {
    return [429, 503, 504].includes(error.status);
  }
  
  calculateBackoff(error, attempt) {
    if (error.status === 429) {
      // Exponential: 100ms * 2^attempt
      return Math.min(100 * Math.pow(2, attempt), 5000);
    }
    
    if (error.status === 503) {
      // Exponential with jitter
      const base = 1000 * Math.pow(2, attempt);
      const jitter = Math.random() * 1000;
      return Math.min(base + jitter, 30000);
    }
    
    return 1000;
  }
}
```

---

## 7. Migration from Current L1/L2

### 7.1 Current → MVP Mapping

| Current | MVP | Changes |
|---------|-----|---------|
| `GET /health` | `GET /health` | Now verifies storage |
| `POST /` | `POST /v1/memory` | Now requires idempotencyKey, returns receipt |
| `POST /mesh/shared-pool` | `POST /v1/shared-pool` | Now uses structured tokens |
| (none) | `POST /v1/sync` | New endpoint |
| (none) | `POST /v1/sync/ack` | New endpoint |

### 7.2 Backward Compatibility

**Phase 1 (Transition):** Keep old endpoints, add deprecation headers:

```javascript
// Legacy endpoint wrapper
app.post('/', (req, res) => {
  res.setHeader('Deprecation', 'Sun, 01 Jun 2026 00:00:00 GMT');
  res.setHeader('Sunset', 'Sun, 01 Sep 2026 00:00:00 GMT');
  res.setHeader('Link', '</v1/memory>; rel="successor-version"');
  
  // Forward to new handler with compatibility translation
  return legacyMemoryHandler(req, res);
});
```

**Phase 2 (Removal):** Remove legacy endpoints after Sunset date.

---

## 8. Testing Checklist

### 8.1 Durability Tests

- [ ] Kill process immediately after write ack → entry is recoverable from WAL
- [ ] Disk full during write → 503 with clear error, no partial writes
- [ ] Permission denied → 503, no crash

### 8.2 Idempotency Tests

- [ ] Same idempotencyKey, different content → second write rejected with 409
- [ ] Same idempotencyKey, same content → 200 with same receipt
- [ ] Different idempotencyKey, same content → 201 with new receipt

### 8.3 Auth Tests

- [ ] Valid token for matching agentId → 201
- [ ] Valid token for different agentId → 403
- [ ] Invalid token → 401
- [ ] Expired token → 401

### 8.4 Consistency Tests

- [ ] `?consistency=eventual` → fast, may miss recent writes
- [ ] `?consistency=strong` → slower, sees all writes (up to timeout)
- [ ] Strong with timeout → falls back to eventual gracefully

---

## 9. Deployment Notes

### 9.1 Required Environment Variables

```bash
# Node identity
MESH_NODE_ID=liz
MESH_AGENT_ID=liz

# Security
MESH_SHARED_SECRET="min-32-byte-secret-for-hs256-signing"
MESH_TOKEN_TTL_HOURS=24

# Storage
MESH_STORAGE_PATH=/home/erik-ross/.openclaw/workspace/memory/mesh
MESH_WAL_PATH=/home/erik-ross/.openclaw/workspace/memory/wal
MESH_MIN_FREE_BYTES=104857600  # 100MB

# Sync
MESH_SYNC_TIMEOUT_MS=5000
MESH_BATCH_SIZE=100

# Rate limiting
MESH_RATE_LIMIT_RPS=100
```

### 9.2 Systemd Service Update

```ini
# /etc/systemd/user/mesh-memory.service

[Unit]
Description=mesh-memory MVP API
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/erik-ross/.openclaw/workspace/projects/mesh-memory
ExecStart=/usr/bin/node api/server.mjs
Restart=always
RestartSec=10

Environment=NODE_ENV=production
Environment=MESH_NODE_ID=liz
EnvironmentFile=/home/erik-ross/.openclaw/workspace/projects/mesh-memory/.env

[Install]
WantedBy=default.target
```

---

## 10. References

- `MESH_MEMORY_MVP_API.yaml` — Complete OpenAPI spec
- `A2A_RECEIVER_SPEC.md` — Peer verification protocol
- `AGENT_GUIDELINES.md` — Agent behavior expectations
- AGENTS.md — ILHCEV methodology, RFC requirement
