# A2A + Identity Integration Design

**Status:** Draft  
**Date:** 2026-04-26  
**Author:** Liz (subagent)  
**Version:** 0.1.0

---

## Executive Summary

This document specifies the integration between the mesh-memory **Identity Passport** system (Ed25519-based sovereign identity) and the **A2A Gateway** (token-based peer-to-peer messaging). The goal is to add cryptographic message signing and verification to A2A traffic while maintaining backward compatibility during the transition period.

**Key Goals:**
1. Cryptographically verifiable agent identity on all A2A messages
2. Eliminate reliance on shared secrets (tokens) for identity verification
3. Maintain backward compatibility with existing token-based auth
4. Enable seamless peer identity verification via passport registry

---

## 1. Current State Analysis

### 1.1 Identity Passport System

The `identity-passport.mjs` module provides:

```typescript
class AgentPassport {
  passportId: string;           // UUID v4 - immutable
  agentName: string;            // Canonical name (e.g., "Liz")
  publicKey: string;           // Ed25519 public key (base64)
  keyFingerprint: string;       // SHA-256 hash of public key
  #privateKey: string;        // Ed25519 private key (base64, never serialized)
  
  sign(data): string;          // Sign with Ed25519
  verify(data, signature): boolean;  // Verify with Ed25519
}
```

**Key Properties:**
- Passport is the L0 immutable identity root
- Private key never leaves the node (stored in `~/.openclaw/.passport.key`)
- Public passport (without private key) is shared in mesh registry

### 1.2 A2A Gateway System

The A2A Gateway (`@a2a-js/sdk` based) currently uses:

```typescript
// Current peer configuration (openclaw.json)
interface PeerConfig {
  name: string;               // "Ray", "Woodhouse"
  agentCardUrl: string;       // Discovery endpoint
  auth?: {
    type: "bearer" | "apiKey";
    token: string;           // Shared secret
  };
}

// Current message flow
POST /a2a/jsonrpc
Authorization: Bearer <shared_token>
Body: { jsonrpc: "2.0", method: "tasks/send", params: {...} }
```

**Current Limitations:**
- Token-based auth requires pre-shared secrets
- No cryptographic proof of sender identity
- Tokens can be stolen/replayed
- No standardized way to verify agent authenticity

---

## 2. Design Overview

### 2.1 Integration Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    A2A + Identity Integration                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  SENDER SIDE                                                            │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │  Outbound Message                                                │  │
│  │                                                                  │  │
│  │  1. Construct A2A payload (tasks/send, tasks/sendSubscribe, etc) │  │
│  │  2. Add Identity Envelope:                                       │  │
│  │     { passportId, keyFingerprint, timestamp, nonce }           │  │
│  │  3. Sign (payload + envelope) with Ed25519 private key          │  │
│  │  4. Send via A2A Gateway with Bearer token (legacy auth)        │  │
│  │                                                                  │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                              │                                          │
│                              ▼ A2A Transport                             │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │  RECEIVER SIDE                                                   │  │
│  │                                                                  │  │
│  │  1. Validate Bearer token (legacy, continues during transition)  │  │
│  │  2. Extract Identity Envelope from message                       │  │
│  │  3. Lookup sender passport in local registry                     │  │
│  │  4. Verify signature using sender's public key                   │  │
│  │  5. Verify timestamp (prevent replay attacks)                  │  │
│  │  6. Verify nonce (prevent replay attacks)                      │  │
│  │  7. Process message if all checks pass                           │  │
│  │                                                                  │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Trust Model

| Layer | Mechanism | Purpose | Status |
|-------|-----------|---------|--------|
| L1 | Bearer Token | Transport security, rate limiting | Existing |
| L2 | Ed25519 Signature | Identity verification, non-repudiation | **New** |
| L3 | Passport Registry | Long-term identity attestation | **New** |

**Transition Strategy:**
- Phase 1 (Current): Token-only (existing)
- Phase 2 (Transition): Token + Signature (both required)
- Phase 3 (Future): Signature-only (token becomes optional for transport only)

---

## 3. Message Format Specification

### 3.1 Signed A2A Message Structure

```typescript
// New top-level envelope for A2A messages
interface SignedA2AMessage {
  // Standard A2A JSON-RPC envelope
  jsonrpc: "2.0";
  method: "tasks/send" | "tasks/sendSubscribe" | "tasks/get" | ...;
  params: TaskSendParams | ...;
  id: string | number;
  
  // Identity envelope (new)
  _identity?: IdentityEnvelope;
}

interface IdentityEnvelope {
  // Who is sending
  passportId: string;           // UUID of sender's passport
  keyFingerprint: string;       // SHA-256 fingerprint of public key used
  agentName: string;            // Human-readable agent name
  
  // Anti-replay
  timestamp: string;            // ISO 8601, must be within ±5 minutes of receiver time
  nonce: string;                // Random 32-byte hex string, unique per message
  
  // Signature
  algorithm: "Ed25519";         // Signature algorithm
  signature: string;            // Base64-encoded Ed25519 signature
  
  // What is signed
  signedPayload: {
    method: string;             // A2A method being called
    paramsHash: string;         // Blake3 hash of canonicalized params
    timestamp: string;          // Same as envelope timestamp
    nonce: string;              // Same as envelope nonce
  };
}
```

### 3.2 Signature Computation

```javascript
// Pseudocode for signature computation
function computeSignature(privateKey, method, params, timestamp, nonce) {
  // 1. Canonicalize params (stable JSON serialization)
  const canonicalParams = canonicalizeJSON(params);
  
  // 2. Hash params
  const paramsHash = blake3(canonicalParams);
  
  // 3. Build payload to sign
  const payload = {
    method,
    paramsHash,
    timestamp,
    nonce
  };
  
  // 4. Canonicalize and sign
  const canonicalPayload = canonicalizeJSON(payload);
  return ed25519Sign(privateKey, canonicalPayload);
}
```

**Canonicalization Rules:**
1. JSON keys sorted alphabetically
2. No whitespace
3. UTF-8 encoding
4. Numbers as strings to avoid precision issues

### 3.3 Example Signed Message

```json
{
  "jsonrpc": "2.0",
  "method": "tasks/send",
  "params": {
    "id": "task_abc123",
    "sessionId": "sess_xyz789",
    "acceptedOutputModes": ["text"],
    "message": {
      "role": "user",
      "parts": [{ "type": "text", "text": "Hello Ray" }]
    }
  },
  "id": 1,
  "_identity": {
    "passportId": "550e8400-e29b-41d4-a716-446655440000",
    "keyFingerprint": "a1b2c3d4e5f6...",
    "agentName": "liz",
    "timestamp": "2026-04-26T21:30:00Z",
    "nonce": "f47ac10b58cc4372a5670e02b2c3d479",
    "algorithm": "Ed25519",
    "signature": "base64encodedsignature...",
    "signedPayload": {
      "method": "tasks/send",
      "paramsHash": "blake3hash...",
      "timestamp": "2026-04-26T21:30:00Z",
      "nonce": "f47ac10b58cc4372a5670e02b2c3d479"
    }
  }
}
```

---

## 4. Peer Identity Verification Flow

### 4.1 Registry-Based Verification

```typescript
class IdentityVerifier {
  constructor(passportRegistry, trustedGenesisEntities) {
    this.registry = passportRegistry;
    this.trustedGenesis = trustedGenesisEntities;
  }
  
  async verifyMessage(message) {
    const envelope = message._identity;
    
    // Step 1: Basic validation
    if (!envelope) {
      return { verified: false, reason: "No identity envelope" };
    }
    
    // Step 2: Timestamp check (prevent replay)
    const msgTime = new Date(envelope.timestamp);
    const now = new Date();
    const drift = Math.abs(now - msgTime) / 1000;
    if (drift > 300) { // 5 minutes
      return { verified: false, reason: "Timestamp drift exceeded" };
    }
    
    // Step 3: Nonce check (prevent replay)
    if (await this.nonceStore.has(envelope.nonce)) {
      return { verified: false, reason: "Replay detected" };
    }
    await this.nonceStore.set(envelope.nonce, true, 600); // 10 min TTL
    
    // Step 4: Lookup passport
    const passport = await this.registry.getByFingerprint(envelope.keyFingerprint);
    if (!passport) {
      return { verified: false, reason: "Unknown passport" };
    }
    
    if (passport.passportId !== envelope.passportId) {
      return { verified: false, reason: "Passport ID mismatch" };
    }
    
    // Step 5: Verify signature
    const payload = canonicalizeJSON(envelope.signedPayload);
    const isValid = passport.verify(payload, envelope.signature);
    if (!isValid) {
      return { verified: false, reason: "Invalid signature" };
    }
    
    // Step 6: Trust check
    const trustLevel = await this.calculateTrust(passport);
    if (trustLevel < 0.3) {
      return { verified: false, reason: "Insufficient trust" };
    }
    
    return { 
      verified: true, 
      passportId: envelope.passportId,
      agentName: envelope.agentName,
      trustLevel 
    };
  }
  
  async calculateTrust(passport) {
    // Check genesis attestation
    const hasGenesis = passport.attestations.some(a => a.type === "genesis");
    if (!hasGenesis) return 0.0;
    
    // Check if genesis issuer is trusted
    const genesis = passport.attestations.find(a => a.type === "genesis");
    const isTrustedGenesis = this.trustedGenesis.includes(genesis.issuer);
    if (isTrustedGenesis) return 1.0;
    
    // Peer-attested trust (simplified)
    const peerAttestations = passport.attestations.filter(a => a.type === "trust");
    return Math.min(0.9, 0.3 + (peerAttestations.length * 0.2));
  }
}
```

### 4.2 Passport Registry Integration

```typescript
// Extend PassportRegistry with fingerprint index
class PassportRegistry {
  async getByFingerprint(fingerprint) {
    // Check local cache first
    if (this.fingerprintIndex.has(fingerprint)) {
      return this.fingerprintIndex.get(fingerprint);
    }
    
    // Load from registry directory
    const passports = await this.loadAll();
    for (const passport of passports) {
      if (passport.keyFingerprint === fingerprint) {
        this.fingerprintIndex.set(fingerprint, passport);
        return passport;
      }
    }
    
    // Request from mesh peers if not found locally
    return await this.discoverFromMesh(fingerprint);
  }
  
  async discoverFromMesh(fingerprint) {
    // Query connected peers for unknown passport
    const peers = await this.getConnectedPeers();
    for (const peer of peers) {
      try {
        const passport = await this.requestPassport(peer, fingerprint);
        if (passport) {
          // Validate before storing
          if (await this.validatePassport(passport)) {
            await this.register(passport);
            return passport;
          }
        }
      } catch (err) {
        continue;
      }
    }
    return null;
  }
}
```

---

## 5. Backward Compatibility Plan

### 5.1 Phase 1: Optional Signatures (Current → 30 days)

**Configuration:**
```json
{
  "a2a": {
    "identity": {
      "mode": "optional",
      "sendSigned": true,
      "requireSigned": false,
      "trustUnsigned": true
    }
  }
}
```

**Behavior:**
- Agents send signed messages when identity is available
- Receivers accept unsigned messages (existing behavior)
- Receivers verify signatures when present
- Trust score adjusted: signed = full trust, unsigned = reduced trust

### 5.2 Phase 2: Preferred Signatures (30-60 days)

**Configuration:**
```json
{
  "a2a": {
    "identity": {
      "mode": "preferred",
      "sendSigned": true,
      "requireSigned": false,
      "trustUnsigned": false,
      "warnUnsigned": true
    }
  }
}
```

**Behavior:**
- Unsigned messages accepted but logged as warnings
- Unsigned messages get reduced trust score (0.5)
- UI/console warnings for unsigned traffic

### 5.3 Phase 3: Required Signatures (60+ days)

**Configuration:**
```json
{
  "a2a": {
    "identity": {
      "mode": "required",
      "sendSigned": true,
      "requireSigned": true,
      "allowlist": ["legacy-peer-1", "legacy-peer-2"]
    }
  }
}
```

**Behavior:**
- Unsigned messages rejected (401 Unauthorized)
- Legacy peers can be allowlisted during final migration
- Tokens still used for rate limiting but not identity

### 5.4 Implementation Strategy

```typescript
// Middleware approach for gradual rollout
class IdentityMiddleware {
  constructor(config, passport, registry) {
    this.config = config;
    this.passport = passport;
    this.registry = registry;
  }
  
  async outbound(message, peer) {
    if (!this.config.sendSigned || !this.passport.canSign) {
      return message; // Unsigned
    }
    
    // Check peer capability
    const peerSupportsIdentity = await this.checkPeerCapability(peer);
    if (!peerSupportsIdentity && this.config.mode === "optional") {
      return message; // Don't break legacy peers
    }
    
    // Sign message
    return await this.signMessage(message);
  }
  
  async inbound(message, peer) {
    const envelope = message._identity;
    
    if (!envelope) {
      // Unsigned message received
      switch (this.config.mode) {
        case "required":
          if (!this.config.allowlist.includes(peer.name)) {
            throw new Error("Identity required");
          }
          break;
        case "preferred":
          console.warn(`[A2A] Unsigned message from ${peer.name}`);
          break;
        case "optional":
        default:
          // Accept silently
          break;
      }
      return { verified: false, trust: 0.5 };
    }
    
    // Verify signed message
    return await this.verifier.verifyMessage(message);
  }
}
```

---

## 6. Implementation Plan

### 6.1 Component Mapping

| Component | New/Modified | Purpose |
|-----------|-------------|---------|
| `a2a-identity-middleware.mjs` | New | Sign outbound, verify inbound |
| `identity-passport.mjs` | Extend | Add A2A-specific signing methods |
| `passport-registry.mjs` | Extend | Add fingerprint index, mesh discovery |
| `a2a-integration.mjs` | Modify | Wire identity into send/receive flow |
| `a2a-gateway/index.ts` | Modify | Add identity verification middleware |
| `openclaw.json` | Extend | Add identity configuration section |

### 6.2 File Structure

```
projects/mesh-memory/
├── src/
│   ├── identity-passport.mjs           # (exists) Add a2aSign/a2aVerify
│   ├── passport-registry.mjs           # (new) Fingerprint-based registry
│   ├── a2a-identity-middleware.mjs     # (new) Main integration logic
│   └── a2a-integration.mjs             # (modify) Integrate middleware
├── passports/                          # (exists) Shared passport storage
│   ├── liz.json
│   ├── ray.json
│   └── woodhouse.json
└── docs/
    └── a2a-identity-integration.md     # (this document)
```

### 6.3 Implementation Phases

**Phase 1: Foundation (Week 1)**
- [ ] Extend `identity-passport.mjs` with A2A-specific methods
- [ ] Create `passport-registry.mjs` with fingerprint indexing
- [ ] Add identity configuration to `openclaw.json` schema
- [ ] Unit tests for signing/verification

**Phase 2: Middleware (Week 2)**
- [ ] Implement `a2a-identity-middleware.mjs`
- [ ] Integrate into `a2a-integration.mjs` send flow
- [ ] Integrate into `a2a-integration.mjs` receive flow
- [ ] Add nonce store (SQLite with TTL)
- [ ] Integration tests

**Phase 3: Gateway Integration (Week 3)**
- [ ] Modify A2A Gateway to extract and verify identity
- [ ] Add identity verification to receiver middleware chain
- [ ] Update health checks to report identity status
- [ ] End-to-end tests

**Phase 4: Registry Discovery (Week 4)**
- [ ] Implement mesh-based passport discovery
- [ ] Add passport propagation protocol
- [ ] Bootstrap trusted genesis entities
- [ ] Discovery tests

**Phase 5: Rollout (Week 5-6)**
- [ ] Deploy to test environment
- [ ] Monitor with "optional" mode
- [ ] Gradually shift to "preferred"
- [ ] Document lessons learned

---

## 7. Security Considerations

### 7.1 Threat Model

| Threat | Mitigation |
|--------|------------|
| Signature forgery | Ed25519 cryptographic security |
| Replay attacks | Timestamp + nonce validation |
| Passport spoofing | Registry verification + genesis attestations |
| Key compromise | Key rotation with history validation |
| Man-in-the-middle | Combined with TLS (transport) + signatures (identity) |
| Clock skew attacks | ±5 minute window + NTP sync requirement |

### 7.2 Key Rotation

```typescript
// Key rotation preserves old signatures in history
class AgentPassport {
  async rotateKey(reason) {
    // 1. Generate new keypair
    const newKeypair = await generateKeyPair();
    
    // 2. Add old key to history
    this.keyHistory.push({
      version: this.passportVersion,
      publicKey: this.publicKey,
      fingerprint: this.keyFingerprint,
      rotatedAt: new Date().toISOString(),
      rotatedBy: this.agentName,
      reason
    });
    
    // 3. Update current key
    this.publicKey = newKeypair.publicKey;
    this.keyFingerprint = newKeypair.fingerprint;
    this.#privateKey = newKeypair.privateKey;
    this.passportVersion++;
    
    // 4. Create rotation attestation
    await this.addAttestation({
      type: "key-rotation",
      issuer: this.passportId,
      payload: { reason, previousFingerprint: this.keyFingerprint }
    });
  }
  
  // Verify with historical keys
  verifyWithHistory(data, signature, fingerprint) {
    // Try current key first
    if (fingerprint === this.keyFingerprint) {
      return this.verify(data, signature);
    }
    
    // Check key history
    const historical = this.keyHistory.find(k => k.fingerprint === fingerprint);
    if (historical) {
      return verifyWithKey(data, signature, historical.publicKey);
    }
    
    return false;
  }
}
```

### 7.3 Nonce Store

```typescript
// SQLite-based nonce store with automatic expiration
class NonceStore {
  constructor(db) {
    this.db = db;
    this.init();
  }
  
  async init() {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS seen_nonces (
        nonce TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_expires ON seen_nonces(expires_at);
    `);
    
    // Periodic cleanup
    setInterval(() => this.cleanup(), 60000);
  }
  
  async has(nonce) {
    const row = await this.db.get(
      "SELECT 1 FROM seen_nonces WHERE nonce = ?",
      [nonce]
    );
    return !!row;
  }
  
  async set(nonce, value, ttlSeconds) {
    const now = Date.now();
    const expires = now + (ttlSeconds * 1000);
    await this.db.run(
      "INSERT OR REPLACE INTO seen_nonces (nonce, timestamp, expires_at) VALUES (?, ?, ?)",
      [nonce, now, expires]
    );
  }
  
  async cleanup() {
    await this.db.run(
      "DELETE FROM seen_nonces WHERE expires_at < ?",
      [Date.now()]
    );
  }
}
```

---

## 8. Configuration Reference

### 8.1 openclaw.json Identity Section

```json
{
  "identity": {
    "passport": {
      "enabled": true,
      "path": "~/.openclaw/passport.json",
      "privateKeyPath": "~/.openclaw/.passport.key"
    },
    "registry": {
      "path": "./passports",
      "autoDiscover": true,
      "trustedGenesis": ["erik-ross", "liz", "ray", "woodhouse"]
    }
  },
  "a2a": {
    "identity": {
      "mode": "optional",
      "sendSigned": true,
      "requireSigned": false,
      "trustUnsigned": true,
      "warnUnsigned": false,
      "allowlist": [],
      "timestampWindowSeconds": 300,
      "nonceTtlSeconds": 600
    }
  }
}
```

### 8.2 Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `A2A_IDENTITY_MODE` | Override mode setting | from config |
| `A2A_SKIP_IDENTITY` | Disable identity for testing | false |
| `PASSPORT_PATH` | Override passport location | ~/.openclaw/passport.json |

---

## 9. Testing Strategy

### 9.1 Unit Tests

```javascript
// Test: Sign and verify message
test('sign and verify A2A message', async () => {
  const passport = await AgentPassport.generate({ agentName: 'test' });
  const message = { method: 'tasks/send', params: { id: 'test-123' } };
  
  const signed = await middleware.signMessage(message, passport);
  
  assert(signed._identity.signature);
  assert(signed._identity.passportId === passport.passportId);
  
  const verified = await verifier.verifyMessage(signed);
  assert(verified.verified === true);
});

// Test: Replay attack prevention
test('reject replayed message', async () => {
  const signed = await middleware.signMessage(message, passport);
  
  // First acceptance
  const result1 = await verifier.verifyMessage(signed);
  assert(result1.verified === true);
  
  // Second attempt (replay)
  const result2 = await verifier.verifyMessage(signed);
  assert(result2.verified === false);
  assert(result2.reason === 'Replay detected');
});
```

### 9.2 Integration Tests

```javascript
// Test: Full A2A flow with identity
test('A2A send with identity verification', async () => {
  // Setup two agents with passports
  const sender = await setupAgent('sender');
  const receiver = await setupAgent('receiver');
  
  // Exchange passports (bootstrap)
  await exchangePassports(sender, receiver);
  
  // Send signed message
  const result = await sender.a2a.send(receiver.name, 'Hello!');
  assert(result.success === true);
  
  // Verify receiver identified sender correctly
  const received = await receiver.getLastMessage();
  assert(received.verified === true);
  assert(received.agentName === 'sender');
});
```

---

## 10. References

| Document | Purpose |
|----------|---------|
| `IDENTITY_ARCHITECTURE.md` | Passport system design |
| `MESH_A2A_INTEGRATION.md` | A2A + mesh-memory integration |
| `identity-passport.mjs` | Passport implementation |
| `A2A_RECEIVER_SPEC.md` | A2A protocol specification |
| `@a2a-js/sdk` | Official A2A SDK documentation |

---

## Appendix A: Migration Checklist

```
□ Generate Ed25519 keypairs for all agents
□ Create passport files with genesis attestations
□ Deploy identity middleware in "optional" mode
□ Monitor logs for signature verification success/failure
□ Update peer registry with all public passports
□ Test cross-agent identity verification
□ Enable "preferred" mode on test environment
□ Monitor for unsigned message warnings
□ Resolve any unsigned traffic sources
□ Enable "required" mode (after full migration)
□ Remove token-based identity reliance
□ Document operational procedures
```

---

*Document version: 0.1.0*  
*Last updated: 2026-04-26*  
*Author: Liz (subagent)*
