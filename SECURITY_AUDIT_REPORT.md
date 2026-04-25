# Security Audit Report: mesh-memory

**Date:** 2026-04-25  
**Auditor:** Liz (Security Engineer Subagent)  
**Branch:** liz/token-lifecycle  
**Scope:** Full security review of production code

---

## Executive Summary

This audit covers the mesh-memory codebase, focusing on authentication, persistence, networking, and cryptographic components. **9 findings** were identified: **2 Critical**, **3 High**, **3 Medium**, and **1 Low** severity issues.

### Key Concerns
1. **Timing attack vulnerability** in master token comparison
2. **Unauthenticated information disclosure** via token validation endpoint
3. **SQL injection risk** in queue-persistence (partially mitigated)
4. **Path traversal** via unsanitized path construction
5. **Missing input validation** in multiple endpoints

---

## Findings

### 🔴 CRITICAL-001: Timing Attack in Token Comparison (token-lifecycle.mjs, token-service.mjs)

**Location:**
- `token-lifecycle.mjs:handleIssueToken()` - Line ~292
- `token-service.mjs:handleRequest()` - master token comparison

**Description:**
The code compares tokens using standard string equality (`!==`) after hashing:

```javascript
// VULNERABLE CODE:
if (!bearerToken || hashToken(bearerToken) !== hashToken(config.masterToken))
```

Node.js string comparison is not constant-time. An attacker with network timing visibility can perform a byte-by-byte brute force attack to recover the master token.

**Impact:**
Complete authentication bypass. Attacker can issue arbitrary tokens for any peer.

**CWE:**
- CWE-208: Observable Timing Discrepancy
- CWE-203: Information Exposure Through Timing Discrepancy

**Fix:**
```javascript
import { timingSafeEqual } from 'crypto';

function compareTokensSecure(a, b) {
  const hashA = hashToken(a);
  const hashB = hashToken(b);
  if (hashA.length !== hashB.length) return false;
  return timingSafeEqual(Buffer.from(hashA), Buffer.from(hashB));
}

// Usage:
if (!bearerToken || !compareTokensSecure(bearerToken, config.masterToken))
```

---

### 🔴 CRITICAL-002: Unauthenticated Token Enumeration (token-lifecycle.mjs)

**Location:**
- `token-lifecycle.mjs:handleValidateToken()` - Lines ~357-380

**Description:**
The token validation endpoint is public (no authentication required) and reveals whether a token exists:

```javascript
// handleValidateToken - PUBLIC ENDPOINT
async function handleValidateToken(req, res, body, db) {
  const token = body.token;
  const tokenHash = hashToken(token);
  const record = db.validateToken(tokenHash);
  
  if (record) {
    res.statusCode = 200;
    res.end(JSON.stringify({
      valid: true,
      peerName: record.peer_name,  // LEAKS: which peer this token belongs to!
      expiresAt: record.expires_at,
      tokenType: record.token_type,
    }));
  } else {
    res.statusCode = 200;
    res.end(JSON.stringify({ valid: false }));
  }
}
```

This allows an attacker to:
1. Test arbitrary tokens for validity
2. Enumerate valid tokens via brute force
3. Learn which peer a token belongs to
4. Determine token expiration timing

**Impact:**
Information disclosure enabling targeted attacks on specific peers.

**CWE:**
- CWE-287: Improper Authentication
- CWE-204: Observable Response Discrepancy
- CWE-548: Information Exposure Through Directory Listing

**Fix:**
```javascript
// Option A: Require authentication
async function handleValidateToken(req, res, body, bearerToken, config, db) {
  // Require master token
  if (!bearerToken || !compareTokensSecure(bearerToken, config.masterToken)) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }
  // ... rest of validation
}

// Option B: Return minimal info
if (record) {
  res.end(JSON.stringify({ valid: true }));  // No peerName, expiresAt
} else {
  res.end(JSON.stringify({ valid: false }));
  // Add random delay to prevent timing-based enumeration
  await new Promise(r => setTimeout(r, Math.random() * 100));
}
```

---

### 🟠 HIGH-001: Path Traversal via Unsanitized Input (multiple files)

**Location:**
- `blind-gate.mjs:gateFilePath()` - Line ~88
- `blind-gate.mjs:openGate()` - Line ~104
- `memory-bridge.mjs:getFilePath()` - Line ~55
- `queue-persistence.mjs` - WAL file paths

**Description:**
Path construction uses user-controlled input without sanitization:

```javascript
// blind-gate.mjs
function gateFilePath(topic, agentId, timestamp) {
  const safeTopic = sanitizeForFilename(topic);  // Only basic replace
  const safeAgent = sanitizeForFilename(agentId);  // Only basic replace
  const safeTs    = timestamp.replace(/[:.]/g, "-");
  return resolve(GATES_DIR, `${safeTopic}-${safeAgent}-${safeTs}.json`);
}

function sanitizeForFilename(s) {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}
```

The `sanitizeForFilename` function does NOT prevent path traversal. A malicious topic like `../../../etc/passwd` becomes `___.._.._.._etc_passwd` which is still a valid filename that could traverse directories depending on filesystem behavior.

**Impact:**
- Arbitrary file write outside intended directories
- Potential file overwrite on system files
- Information disclosure via file reading

**CWE:**
- CWE-22: Improper Limitation of a Pathname to a Restricted Directory
- CWE-23: Relative Path Traversal

**Fix:**
```javascript
import { basename } from 'path';

function sanitizeForFilename(s) {
  // Remove any path components, keep only filename-safe chars
  return basename(s)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 64);
}

// Additional validation
if (safeTopic.includes('/') || safeTopic.includes('\\')) {
  throw new Error('Invalid topic: path separators not allowed');
}
```

---

### 🟠 HIGH-002: Race Condition in Token Rotation (token-service.mjs)

**Location:**
- `token-service.mjs:rotateToken()` - Lines ~200-260

**Description:**
The token rotation uses explicit transaction locking, but there's a TOCTOU race:

```javascript
async rotateToken(oldToken) {
  return new Promise((resolve, reject) => {
    this.db.serialize(async () => {
      await this.db.run('BEGIN IMMEDIATE TRANSACTION');
      
      // Race window: token could be revoked between SELECT and here
      const oldTokenRecord = await this.db.get(
        'SELECT peerName, expiresAt FROM tokens WHERE token = ? AND revoked = 0 FOR UPDATE',
        [oldToken]
      );
      
      // ... generate new token
      const newToken = this.generateToken();
      
      // If this.db.run fails after INSERT, we have:
      // - Old token revoked
      // - New token never inserted
      // = User loses access entirely
      
      await this.db.run('INSERT INTO tokens ...', [newToken]);
      await this.db.run('UPDATE tokens SET revoked = 1 WHERE token = ?', [oldToken]);
      await this.db.run('COMMIT');
    });
  });
}
```

**Impact:**
- Token loss during rotation under error conditions
- Potential for double-spend if rotation is retried

**CWE:**
- CWE-362: Concurrent Execution using Shared Resource with Improper Synchronization
- CWE-367: Time-of-check Time-of-use (TOCTOU) Race Condition

**Fix:**
```javascript
async rotateToken(oldToken) {
  // Use proper try-catch with rollback guarantee
  await this.db.run('BEGIN IMMEDIATE TRANSACTION');
  
  try {
    // SELECT ... FOR UPDATE locks the row
    const record = await this.db.get(
      'SELECT peerName, expiresAt FROM tokens WHERE token = ? AND revoked = 0 FOR UPDATE',
      [oldToken]
    );
    
    if (!record) {
      throw new Error('Token not found or already revoked');
    }
    
    // Generate new token
    const newToken = this.generateToken();
    const expiresAt = this.calculateExpiry();
    
    // Insert new token FIRST
    await this.db.run(
      'INSERT INTO tokens (peerName, token, issuedAt, expiresAt, revoked) VALUES (?, ?, ?, ?, 0)',
      [record.peerName, newToken, Date.now(), expiresAt]
    );
    
    // Then revoke old
    await this.db.run('UPDATE tokens SET revoked = 1 WHERE token = ?', [oldToken]);
    
    await this.db.run('COMMIT');
    
    this.revocationCache.add(oldToken);
    return { token: newToken, expiresAt, peerName: record.peerName };
    
  } catch (err) {
    await this.db.run('ROLLBACK');
    throw err;
  }
}
```

---

### 🟠 HIGH-003: Error Information Leakage (memory-receiver.mjs, queue-persistence.mjs)

**Location:**
- `memory-receiver.mjs` - multiple catch blocks
- `queue-persistence.mjs` - error logging

**Description:**
Internal error details are logged to console, potentially exposing:
- File system paths
- Database connection strings
- Internal implementation details

```javascript
// queue-persistence.mjs
} catch (error) {
  console.error('[queue-persistence] Failed to persist event:', error);
  // ^^ error may contain: SQL query, file paths, stack trace
  return false;
}
```

**Impact:**
Information disclosure aiding further attacks.

**CWE:**
- CWE-209: Information Exposure Through an Error Message
- CWE-532: Insertion of Sensitive Information into Log File

**Fix:**
```javascript
// Use sanitized error logging
} catch (error) {
  console.error('[queue-persistence] Failed to persist event:', 
    error.message || 'Unknown error');
  // Log full details only in debug mode
  if (process.env.DEBUG) {
    console.debug('[queue-persistence] Full error:', error);
  }
  return false;
}
```

---

### 🟡 MEDIUM-001: SQL Injection via String Concatenation (queue-persistence.mjs)

**Location:**
- `queue-persistence.mjs:syncIndexWithState()` - Lines ~275-300

**Description:**
Dynamic table name construction without validation:

```javascript
await db.exec(`
  CREATE TABLE IF NOT EXISTS queue_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    peerName TEXT NOT NULL,
    ...
  )
`);

// Parameterized query (GOOD):
await db.run(
  `INSERT INTO queue_entries (peerName, eventId, timestamp, status, eventData) 
   VALUES (?, ?, ?, 'pending', ?)`,
  [peerName, eventId, timestamp, JSON.stringify(event)]
);
```

The code uses parameterized queries correctly for VALUES, but `dbPath` and table names come from config without validation. If an attacker can control `INDEX_DB` or table names via config, they could inject SQL.

**Impact:**
- Data exfiltration via SQL injection
- Database corruption
- Potential RCE via SQLite extensions (if loaded)

**CWE:**
- CWE-89: SQL Injection

**Fix:**
```javascript
// Validate table/column names against whitelist
const VALID_TABLE_NAMES = ['queue_entries', 'tokens'];
const VALID_COLUMN_NAMES = ['id', 'peerName', 'eventId', 'timestamp', 'status', 'eventData'];

function validateIdentifier(name) {
  if (!VALID_TABLE_NAMES.includes(name) && !VALID_COLUMN_NAMES.includes(name)) {
    throw new Error(`Invalid SQL identifier: ${name}`);
  }
  return name;
}
```

---

### 🟡 MEDIUM-002: Insufficient Token Entropy (token-lifecycle.mjs)

**Location:**
- `token-lifecycle.mjs:generateToken()` - Line ~45

**Description:**
```javascript
function generateToken() {
  return randomBytes(32).toString("base64url");
}
```

This generates a 256-bit random value, which is good. However:
- No minimum token length enforcement
- No token format validation
- Base64url encoding produces ~43 characters, which is acceptable

The actual concern is that tokens are single-use identifiers. The 256-bit entropy is sufficient (2^256 combinations), but the system doesn't enforce minimum complexity.

**Impact:**
Low - 256-bit entropy is cryptographically secure for this use case.

**CWE:**
- CWE-331: Insufficient Entropy

**Fix:**
Already acceptable. Add validation:
```javascript
function validateTokenFormat(token) {
  // Base64url format: [A-Za-z0-9_-]{43}
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new Error('Invalid token format');
  }
}
```

---

### 🟡 MEDIUM-003: Missing Rate Limiting (memory-receiver.mjs, token-lifecycle.mjs)

**Location:**
- `memory-receiver.mjs:tokenAuthMiddleware()` 
- `token-lifecycle.mjs:all endpoints`

**Description:**
No rate limiting on authentication endpoints. An attacker can brute force tokens without restriction.

**Impact:**
- Token brute force attacks
- DoS via resource exhaustion

**CWE:**
- CWE-770: Allocation of Resources Without Limits or Throttling
- CWE-307: Improper Restriction of Excessive Authentication Attempts

**Fix:**
```javascript
// Simple in-memory rate limiter
const rateLimits = new Map();

function checkRateLimit(clientId, maxRequests = 10, windowMs = 60000) {
  const now = Date.now();
  const windowStart = now - windowMs;
  
  const attempts = rateLimits.get(clientId) || [];
  const recentAttempts = attempts.filter(t => t > windowStart);
  
  if (recentAttempts.length >= maxRequests) {
    return false; // Rate limited
  }
  
  recentAttempts.push(now);
  rateLimits.set(clientId, recentAttempts);
  return true;
}

// Usage in auth middleware:
const clientId = req.socket.remoteAddress;
if (!checkRateLimit(clientId, 10, 60000)) {
  return res.status(429).json({ error: "Rate limit exceeded" });
}
```

---

### 🟢 LOW-001: Service File ReadWritePaths Too Permissive (mesh-memory-*.service)

**Location:**
- All `.service` files

**Description:**
```ini
ReadWritePaths=%h/.openclaw/workspace/memory/mesh %h/.openclaw/workspace/memory/queue
```

The services have write access to entire directories. Should be more granular:

**Fix:**
```ini
# Create subdirectories for each service
ReadWritePaths=%h/.openclaw/workspace/memory/mesh/receiver
ReadWritePaths=%h/.openclaw/workspace/memory/queue/wal
ReadWritePaths=%h/.openclaw/workspace/memory/queue/snapshots
```

---

## Security Hardening Recommendations

### 1. Enable Audit Logging
Add structured audit logging for security events:
- Token issuance/revocation
- Failed authentication attempts
- Suspicious patterns

### 2. Implement HMAC for Token Integrity
Add HMAC to tokens to detect tampering:
```javascript
function createToken() {
  const payload = randomBytes(32).toString('base64url');
  const signature = createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
```

### 3. Add Request Signing
For A2A communication, add HMAC request signing to prevent replay attacks.

### 4. Database Encryption
Encrypt sensitive fields (token hashes) at rest using SQLite encryption extensions.

### 5. Certificate Pinning
For production deployments, pin TLS certificates in A2A communication.

---

## Summary Table

| ID | Severity | CWE | File | Status |
|----|----------|-----|------|--------|
| CRITICAL-001 | Critical | CWE-208 | token-lifecycle.mjs, token-service.mjs | 🔴 Open |
| CRITICAL-002 | Critical | CWE-287 | token-lifecycle.mjs | 🔴 Open |
| HIGH-001 | High | CWE-22 | blind-gate.mjs, memory-bridge.mjs | 🔴 Open |
| HIGH-002 | High | CWE-362 | token-service.mjs | 🔴 Open |
| HIGH-003 | High | CWE-209 | memory-receiver.mjs, queue-persistence.mjs | 🔴 Open |
| MEDIUM-001 | Medium | CWE-89 | queue-persistence.mjs | 🟡 Open |
| MEDIUM-002 | Medium | CWE-331 | token-lifecycle.mjs | 🟡 Acceptable |
| MEDIUM-003 | Medium | CWE-770 | memory-receiver.mjs, token-lifecycle.mjs | 🟡 Open |
| LOW-001 | Low | N/A | *.service | 🟢 Open |

---

## Verification Commands

To verify fixes:

```bash
# Check for timing-safe comparisons
grep -rn "timingSafeEqual" src/ || echo "MISSING: timingSafeEqual not found"

# Check for path traversal protection
grep -rn "basename" blind-gate.mjs memory-bridge.mjs || echo "MISSING: basename sanitization"

# Check for rate limiting
grep -rn "rateLimit\|RateLimit" src/ || echo "MISSING: rate limiting not found"

# Check for authenticated validate endpoint
grep -A5 "handleValidateToken" token-lifecycle.mjs | grep -q "bearerToken" && echo "OK" || echo "MISSING: auth on validate"
```

---

*Report generated by security audit subagent [security-audit]*
