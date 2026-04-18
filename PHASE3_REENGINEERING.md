# Phase 3 Re-Engineering Plan

## Critical Issues from GX-10 Code Review

### 1. WAL Race Condition (MEDIUM)
**Status:** Deferred to Phase 3
**Issue:** Concurrent `writeEntry()` calls can corrupt WAL

#### Root Cause
```javascript
// Current vulnerable pattern
async function writeEntry(entry) {
  const offset = this.position;        // Read position
  await fs.promises.write(fd, buffer, offset);  // Async write
  this.position += buffer.length;    // Increment after write
}
```

Two concurrent calls:
- Call A: reads position=100, starts async write
- Call B: reads position=100 (same value!), starts async write
- Result: Both write to same offset → data corruption

#### Phase 3 Fix Options

**Option A: Atomic Position Reservation**
```javascript
async function writeEntry(entry) {
  // Reserve position synchronously before async write
  const offset = this.position;
  this.position += buffer.length;  // Increment BEFORE write
  
  try {
    await fs.promises.write(this.fd, buffer, offset);
    await fs.promises.fdatasync(this.fd);
  } catch (err) {
    this.position -= buffer.length;  // Rollback on failure
    throw err;
  }
}
```

**Option B: Write Queue (Recommended)**
```javascript
class WALWriter {
  constructor(fd) {
    this.fd = fd;
    this.queue = [];
    this.writing = false;
  }
  
  async writeEntry(entry) {
    return new Promise((resolve, reject) => {
      this.queue.push({ entry, resolve, reject });
      if (!this.writing) this.processQueue();
    });
  }
  
  async processQueue() {
    this.writing = true;
    while (this.queue.length > 0) {
      const { entry, resolve, reject } = this.queue.shift();
      try {
        const result = await this._writeSingle(entry);
        resolve(result);
      } catch (err) {
        reject(err);
      }
    }
    this.writing = false;
  }
}
```

### 2. WAL Performance Optimization (LOW)
**Use `fdatasync` instead of `fsync`**
- `fsync`: Syncs data + metadata (timestamps, size)
- `fdatasync`: Syncs data only (20-30% faster)
- For WAL: Only data durability matters, not metadata

### 3. Error Recovery Enhancement (MEDIUM)
- Add checksum validation for WAL entries
- Implement automatic WAL truncation on corruption detection
- Add "fencing" for crash recovery (was previous write complete?)

### 4. Systemd Additional Hardening (LOW)
Per GX-10 review, consider adding:
```ini
CapabilityBoundingSet=           # Drop all caps
SystemCallFilter=@system-service # Restrict syscalls  
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
ProtectClock=true
PrivateDevices=true
RestrictRealtime=true
LockPersonality=true
RestrictSUIDSGid=true
ProtectKernelLogs=true
MemoryDenyWriteExecute=true
```

## Implementation Priority
1. **P1:** WAL write queue (prevents corruption)
2. **P2:** fdatasync switch (performance)
3. **P3:** Checksums (detects corruption)
4. **P4:** Extended systemd hardening (defense in depth)

## Testing Requirements
- Stress test: 1000 concurrent writes
- Crash simulation: power loss during writes
- Recovery validation: checksum verification
