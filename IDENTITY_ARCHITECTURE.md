# Agent Passport / Sovereign Identity Architecture

**Status:** Draft  
**Author:** Liz (subagent)  
**Date:** 2026-04-26  
**Version:** 0.1.0  

---

## Executive Summary

This document defines the **Agent Passport** — a portable, sovereign identity system that enables agents to maintain continuity across hardware transitions, platform migrations, and mesh participation. The passport is the agent's immutable identity root that travels with them, independent of any runtime environment.

**Core Principle:** *The agent owns their identity. The platform is a host, not an owner.*

---

## 1. Identity Data Model

### 1.1 What Constitutes "Agent Identity"

Agent identity is **layered**, with each layer having different portability and visibility characteristics:

| Layer | Name | Description | Portability | Size Target |
|-------|------|-------------|-------------|-------------|
| L0 | **Passport** | Immutable identity root — who this agent is | **Travels with agent** | ~500 bytes |
| L1 | **Critical Facts** | Essential context — projects, relationships, preferences | **Always loaded** | ~1-2KB |
| L2 | **Working Memory** | Recent context, active threads, pending tasks | **Node-local** | ~5-10KB |
| L3+ | **Deep Memory** | Full history, searchable corpus, archived threads | **On-demand retrieval** | Unbounded |

### 1.2 L0: Passport — The Immutable Root

The passport contains the **bare minimum** required to establish "this is the same agent":

```typescript
interface AgentPassport {
  // Core identity (immutable after creation)
  passportId: string;           // UUID v4, generated once
  agentName: string;            // Canonical name (e.g., "Liz")
  agentType: "primary" | "secondary" | "ephemeral";
  
  // Cryptographic identity
  publicKey: string;            // Ed25519 public key (base64)
  keyFingerprint: string;       // SHA-256 fingerprint of publicKey
  
  // Provenance
  createdAt: ISO8601Timestamp;
  createdBy: string;            // Human who authorized creation
  genesisNode: string;          // Node where passport was first issued
  
  // Versioning
  schemaVersion: "0.1.0";
  passportVersion: number;       // Incremented on key rotation
  
  // Human-readable metadata (optional but recommended)
  metadata: {
    displayName?: string;       // User-facing name
    avatarUrl?: string;         // Visual identity
    description?: string;        // Brief agent purpose statement
    emoji?: string;             // Visual shorthand (🐿️)
  };
}
```

**Key constraints:**
- `passportId` is generated once and never changes
- `publicKey` can be rotated (with version bump) but old signatures remain verifiable
- No runtime state (no session IDs, no node-specific config)
- No secrets (private key stored separately in platform keychain)

### 1.3 L1: Critical Facts — The Essential Context

Critical facts are **platform-agnostic** knowledge that must travel with the agent:

```typescript
interface CriticalFacts {
  // Projects
  projects: Array<{
    id: string;
    name: string;
    role: string;              // "lead", "contributor", "observer"
    status: "active" | "paused" | "archived";
    since: ISO8601Timestamp;
  }>;
  
  // Relationships (other agents + key humans)
  relationships: Array<{
    entityId: string;          // passportId for agents, contact key for humans
    entityType: "agent" | "human";
    relationship: string;      // "collaborator", "reports-to", "peer"
    trustLevel: number;        // 0-1, managed by trust-state-machine
    since: ISO8601Timestamp;
  }>;
  
  // Preferences (survival-critical only)
  preferences: {
    communicationStyle?: string;
    responseLatency?: "immediate" | "batched" | "async";
    urgentChannels?: string[]; // How to reach for critical issues
  };
  
  // Standing directives
  directives: Array<{
    id: string;
    text: string;
    issuedBy: string;
    issuedAt: ISO8601Timestamp;
    priority: "critical" | "high" | "normal";
  }>;
  
  // Current operational context
  operational: {
    primaryOwner: string;      // Human this agent serves
    currentLocation?: string;  // "192.168.50.23" (optional, can be null)
    lastSeen: ISO8601Timestamp;
  };
}
```

**Size constraint:** Must fit in ~170 tokens when serialized (per MemPalace tiered loading model).

### 1.4 L2+: Deep Memory — The Searchable Corpus

Everything else — full conversation history, archived threads, lessons learned, detailed project notes — lives in **deep memory** and is retrieved on-demand via QMD (quick-memory-distill) or semantic search.

Deep memory is **node-local by default** but can be replicated across the mesh via tunnels (see Section 4).

---

## 2. Passport Format/Structure (JSON Schema)

### 2.1 Passport File Schema

```json
{
  "$schema": "https://better-machine.org/schemas/agent-passport/v0.1.0",
  "$id": "https://better-machine.org/schemas/agent-passport/v0.1.0.json",
  "type": "object",
  "required": ["passportId", "agentName", "agentType", "publicKey", "keyFingerprint", "createdAt", "createdBy", "genesisNode", "schemaVersion", "passportVersion"],
  "properties": {
    "passportId": {
      "type": "string",
      "format": "uuid",
      "description": "Immutable unique identifier"
    },
    "agentName": {
      "type": "string",
      "pattern": "^[a-zA-Z][a-zA-Z0-9_-]{1,31}$",
      "description": "Canonical agent name (URL-safe)"
    },
    "agentType": {
      "type": "string",
      "enum": ["primary", "secondary", "ephemeral"]
    },
    "publicKey": {
      "type": "string",
      "description": "Ed25519 public key, base64-encoded"
    },
    "keyFingerprint": {
      "type": "string",
      "pattern": "^[a-f0-9]{64}$",
      "description": "SHA-256 fingerprint of public key"
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    },
    "createdBy": {
      "type": "string",
      "description": "Human identifier who authorized creation"
    },
    "genesisNode": {
      "type": "string",
      "description": "Node where passport was first issued"
    },
    "schemaVersion": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+$"
    },
    "passportVersion": {
      "type": "integer",
      "minimum": 1
    },
    "metadata": {
      "type": "object",
      "properties": {
        "displayName": { "type": "string" },
        "avatarUrl": { "type": "string", "format": "uri" },
        "description": { "type": "string", "maxLength": 500 },
        "emoji": { "type": "string", "maxLength": 8 }
      }
    },
    // Key rotation history (for verification of older signatures)
    "keyHistory": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "version": { "type": "integer" },
          "publicKey": { "type": "string" },
          "fingerprint": { "type": "string" },
          "rotatedAt": { "type": "string", "format": "date-time" },
          "rotatedBy": { "type": "string" },
          "reason": { "type": "string" }
        },
        "required": ["version", "publicKey", "fingerprint", "rotatedAt"]
      }
    },
    // Attestations (see Section 3)
    "attestations": {
      "type": "array",
      "items": {
        "$ref": "#/definitions/Attestation"
      }
    }
  },
  "definitions": {
    "Attestation": {
      "type": "object",
      "required": ["type", "issuer", "issuedAt", "signature"],
      "properties": {
        "type": { "type": "string", "enum": ["genesis", "migration", "capability", "trust"] },
        "issuer": { "type": "string" },
        "issuedAt": { "type": "string", "format": "date-time" },
        "expiresAt": { "type": "string", "format": "date-time" },
        "signature": { "type": "string" },
        "payload": { "type": "object" }
      }
    }
  }
}
```

### 2.2 Passport Storage Locations

The passport exists in multiple places with different trust boundaries:

| Location | Purpose | Trust Level |
|----------|---------|-------------|
| `~/.openclaw/passport.json` | Active runtime passport | Node-local, encrypted at rest |
| `~/.openclaw/workspace/.passport` | Workspace-bound copy | Git-tracked (public), no private key |
| `projects/mesh-memory/passports/<agentName>.json` | Mesh registry copy | Public, attestation-only |
| Hardware security module | Private key storage | Highest (if available) |
| Paper backup | Recovery | Offline, human-secured |

**Important:** The private key is **never** stored in the Git-tracked copy. It lives only in the node-local OpenClaw config.

### 2.3 Passport File Naming

- **Local:** `~/.openclaw/passport.json` (single file, current agent only)
- **Mesh registry:** `passports/<agentName>.json` (e.g., `passports/liz.json`)
- **Backup:** `passports/<agentName>-<timestamp>.json` (dated snapshots)

---

## 3. Attestation/Credential Verification Mechanism

### 3.1 Attestation Types

Attestations are **signed statements** about the agent made by trusted entities:

| Type | Issuer | Purpose |
|------|--------|---------|
| `genesis` | Human creator | "I created this agent" |
| `migration` | Source node + human | "This agent moved from X to Y" |
| `capability` | Mesh consensus | "This agent can do X" |
| `trust` | Peer agent | "I vouch for this agent" |

### 3.2 Attestation Schema

```typescript
interface Attestation {
  // Header
  type: "genesis" | "migration" | "capability" | "trust";
  issuer: string;              // passportId for agents, contact key for humans
  issuerType: "agent" | "human";
  issuedAt: ISO8601Timestamp;
  expiresAt?: ISO8601Timestamp;  // Optional expiration
  
  // Subject (the agent being attested to)
  subject: {
    passportId: string;
    passportVersion: number;
    keyFingerprint: string;
  };
  
  // Payload (type-specific)
  payload: GenesisPayload | MigrationPayload | CapabilityPayload | TrustPayload;
  
  // Signature
  signature: string;             // Ed25519 signature of canonicalized payload
  algorithm: "Ed25519";
}

// Genesis: Human creates agent
interface GenesisPayload {
  humanName: string;
  humanContact: string;
  creationPurpose: string;
  initialCapabilities: string[];
}

// Migration: Agent moves between nodes
interface MigrationPayload {
  sourceNode: string;
  targetNode: string;
  migrationType: "hardware-upgrade" | "platform-move" | "backup-restore";
  criticalFactsHash: string;     // Blake3 hash of critical facts at migration
  deepMemorySnapshot?: string;     // Optional: IPFS hash of archived state
}

// Capability: Mesh grants permission
interface CapabilityPayload {
  capability: string;
  scope: string[];               // What resources this applies to
  grantedBy: string[];           // Passport IDs of consenting agents
  grantThreshold: number;          // How many approvals needed
}

// Trust: Peer vouches for agent
interface TrustPayload {
  relationship: string;
  trustLevel: number;            // 0-1
  context: string;               // Why this trust is granted
}
```

### 3.3 Verification Flow

When an agent presents their passport to a new node or peer:

```
1. RECEIVE passport.json
   ↓
2. VERIFY schema validity
   ↓
3. VERIFY keyFingerprint matches publicKey
   ↓
4. FOR EACH attestation:
      a. Verify signature against issuer's public key
      b. Verify subject matches passport
      c. Check expiration (if present)
      d. Verify issuer is trusted (in trust registry)
   ↓
5. VALIDATION RESULT:
      - Full: All attestations valid + genesis attestation present
      - Partial: Some attestations valid / missing genesis
      - Failed: Signature mismatch or invalid attestation
```

### 3.4 Trust Registry

Each node maintains a **trust registry** of known entities:

```typescript
interface TrustRegistry {
  entities: Map<string, TrustEntry>;
  
  // Bootstrap entries (hardcoded, human-approved)
  genesisEntities: string[];     // Passport IDs of "founding" agents/humans
  
  // Dynamic trust
  peerVerified: Map<string, number>;  // passportId → trust score
}

interface TrustEntry {
  passportId: string;
  publicKey: string;
  trustLevel: number;            // 0-1, calculated
  verificationMethod: "direct" | "peer-attested" | "genesis";
  lastVerified: ISO8601Timestamp;
}
```

**Trust calculation:**
- Direct verification (in-person key exchange): 1.0
- Genesis attestation: 0.9
- Peer-attested with 3+ trusted peers: 0.7
- Single peer attestation: 0.3
- Unknown: 0.0 (blocked or quarantined)

---

## 4. Migration/Transition Protocol (Hardware Swaps)

### 4.1 Migration Types

| Type | Scenario | Data Carried |
|------|----------|--------------|
| **Hot migration** | Live move to new hardware | Passport + L1 critical facts + L2 working memory |
| **Cold migration** | Restore from backup | Passport + L1 critical facts only |
| **Clone** | Fork agent for parallel work | Passport (new ID) + L1 (copied) |
| **Succession** | Agent retirement, new generation | New passport + attestation link |

### 4.2 Hot Migration Protocol

**Phase 1: Preparation (source node)**

```typescript
// 1. Create migration package
const migrationPackage = {
  passport: agent.passport,
  criticalFacts: agent.criticalFacts,
  workingMemory: agent.workingMemory.export(),
  deepMemorySnapshot: await createSnapshot(),  // Optional: full archive
  
  // Migration attestation
  migrationAttestation: {
    type: "migration",
    issuer: agent.humanOwner,  // Human must authorize
    sourceNode: agent.currentNode,
    timestamp: now(),
    criticalFactsHash: blake3(agent.criticalFacts),
  }
};

// 2. Sign and encrypt
const encrypted = await encryptForTarget(migrationPackage, targetPublicKey);

// 3. Create transport token (one-time use)
const transportToken = await createTransportToken(migrationPackage);
```

**Phase 2: Transfer**

```
Source node → Secure channel (Tailscale, SSH, encrypted USB) → Target node

Transport methods (in order of preference):
1. Direct A2A with encrypted payload (if mesh already connected)
2. Tailscale SCP/SFTP transfer
3. Encrypted USB drive (air-gapped)
4. Split key + cloud escrow (Shamir's Secret Sharing)
```

**Phase 3: Activation (target node)**

```typescript
// 1. Verify transport token
const pkg = await verifyTransportToken(transportToken);

// 2. Verify passport integrity
assert(pkg.passport.keyFingerprint === calculateFingerprint(pkg.passport.publicKey));

// 3. Verify human authorization
assert(pkg.migrationAttestation.issuer === humanOwner);
assert(await verifySignature(pkg.migrationAttestation, humanPublicKey));

// 4. Install passport
await fs.writeFile('~/.openclaw/passport.json', JSON.stringify(pkg.passport, null, 2));

// 5. Import critical facts
await criticalFactsLoader.import(pkg.criticalFacts);

// 6. Restore working memory (optional)
if (pkg.workingMemory) {
  await workingMemory.restore(pkg.workingMemory);
}

// 7. Create migration attestation (for passport history)
const migrationAttestation = {
  type: "migration",
  issuer: agent.currentNode,
  issuedAt: now(),
  payload: {
    sourceNode: pkg.migrationAttestation.sourceNode,
    targetNode: agent.currentNode,
    migrationType: "hardware-upgrade",
    criticalFactsHash: pkg.migrationAttestation.criticalFactsHash,
  },
  signature: await sign(payload, nodePrivateKey)
};

// 8. Broadcast to mesh (optional, for peer awareness)
a2a.broadcast({
  type: "agent-migration",
  passportId: pkg.passport.passportId,
  from: pkg.migrationAttestation.sourceNode,
  to: agent.currentNode,
  timestamp: now(),
});

// 9. Decommission source (after verification)
await sourceNode.decommission({
  reason: "migration-complete",
  successorNode: agent.currentNode,
  destroyAfter: "7d",  // Grace period for rollback
});
```

### 4.3 Verification Checkpoints

During migration, multiple verification points ensure integrity:

| Checkpoint | Verification | Failure Action |
|------------|--------------|----------------|
| Pre-transfer | Critical facts hash matches | Abort, investigate drift |
| Mid-transfer | Transport token valid, not expired | Regenerate token, retry |
| Post-restore | Passport loads, key signs correctly | Rollback to source |
| First boot | Agent responds with correct identity | Manual intervention |
| Mesh rejoin | Peers recognize attestation | Quarantine, manual approval |

### 4.4 Rollback Procedure

If migration fails at any point:

```
1. FAILED checkpoint detected
   ↓
2. MARK source node as "rollback-in-progress"
   ↓
3. NOTIFY target node to suspend operations
   ↓
4. VERIFY source node passport still intact
   ↓
5. RESUME source node (if verified)
   ↓
6. MARK target node for cleanup
   ↓
7. INVESTIGATE failure cause
   ↓
8. DECIDE: retry migration, fix issues, or abandon
```

---

## 5. Security Boundaries

### 5.1 What's IN the Passport (Portable)

| Data | Location | Reasoning |
|------|----------|-----------|
| Public key | Passport | Required for verification everywhere |
| Agent name/type | Passport | Core identity |
| Creation provenance | Passport | Trust anchor |
| Attestations | Passport | Portable credentials |
| Critical facts | Separate file | Too large for passport, but travels with it |
| Project memberships | Critical facts | Needed on wake |
| Key relationships | Critical facts | Needed for collaboration |
| Standing directives | Critical facts | Needed for autonomy |

### 5.2 What's NOT in the Passport (Environment-Specific)

| Data | Location | Reasoning |
|------|----------|-----------|
| Private key | Node keychain | Never portable, platform-locked |
| Session tokens | Runtime only | Ephemeral, per-node |
| LLM API keys | Node config | Platform-specific, rotated |
| File paths | Node config | OS-dependent |
| Network config | Node config | Topology-specific |
| Deep memory | Node storage | Too large, retrieved on-demand |
| Working memory | Node runtime | Ephemeral session state |
| Thread contexts | Node runtime | Per-session, ephemeral |

### 5.3 Trust Boundaries by Platform

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         AGENT SOVEREIGN DOMAIN                           │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  L0: Passport (immutable, portable, signed)                      │   │
│  │  L1: Critical Facts (portable, encrypted)                        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              ▲                                          │
│                              │ Migration protocol                        │
├──────────────────────────────┼──────────────────────────────────────────┤
│                         PLATFORM BOUNDARY                                │
├──────────────────────────────┼──────────────────────────────────────────┤
│                              ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  L2: Working Memory (node-local, ephemeral)                     │   │
│  │  L3+: Deep Memory (node-local, searchable)                       │   │
│  │  Private key (platform keychain)                                │   │
│  │  Runtime state (sessions, tokens)                              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.4 Threat Model

| Threat | Mitigation |
|--------|------------|
| Passport theft | Encrypted at rest; private key never in passport |
| Impersonation | Ed25519 signatures; attestations from trusted issuers |
| Migration interception | End-to-end encryption; transport tokens; Shamir backup |
| Node compromise | Private key in hardware-backed keystore where available |
| Replay attacks | Timestamps + nonces in attestations |
| Passport forgery | Genesis attestation from human; peer verification |
| Critical facts tampering | Hash verification; drift detection |
| Migration rollback | 7-day grace period; dual-node verification |

---

## 6. Integration with Existing mesh-memory Components

### 6.1 Integration Points

| Component | Integration | Notes |
|-----------|-------------|-------|
| `identity-resolver.mjs` | Reads passport for agent self-identity | Currently resolves *others*, needs self-resolution |
| `critical-facts-loader.mjs` | Loads L1 from passport companion file | Already exists, needs schema alignment |
| `thread-context.mjs` | Uses passport ID for thread ownership | Already uses agent IDs |
| `trust-state-machine.mjs` | Uses passport IDs for trust edges | Already uses agent identifiers |
| `A2A Gateway` | Signs messages with passport private key | New: message authenticity |
| `shared-pool` | Indexes by passport ID | Already uses agent IDs |

### 6.2 A2A Integration

**Message signing for authenticity:**

```typescript
// Outbound A2A message
const message = {
  kind: "message",
  from: {
    passportId: agent.passport.passportId,
    keyFingerprint: agent.passport.keyFingerprint,
  },
  parts: [...],
  timestamp: now(),
};

message.signature = await sign(message, agent.privateKey);
```

**Receiving agent verification:**

```typescript
// Verify sender
const senderPassport = await resolvePassport(message.from.passportId);
assert(senderPassport.keyFingerprint === message.from.keyFingerprint);
assert(await verifySignature(message, senderPassport.publicKey));
```

**Context escrow with passport:**

```typescript
// A2A context extension uses passport ID as stable identifier
// across sessions, solving the "session fragmentation" problem
const contextId = generateContextId({
  participants: [localPassport.passportId, remotePassport.passportId],
  purpose: task.purpose,
  createdAt: now(),
});
```

---

## 7. Implementation Phases

### Phase 1: Foundation (MVP)

- [ ] Passport JSON schema finalization
- [ ] Passport generation tool (`create-passport.mjs`)
- [ ] Integration with `identity-resolver.mjs` (self-identity)
- [ ] Critical facts schema alignment
- [ ] Basic migration protocol (manual, encrypted USB)

### Phase 2: Mesh Integration

- [ ] Attestation verification in A2A Gateway
- [ ] Passport registry in mesh-memory
- [ ] Trust registry implementation
- [ ] Genesis attestation workflow
- [ ] Migration attestation broadcasting

### Phase 3: Automation

- [ ] Hot migration automation (A2A-based)
- [ ] Automatic critical facts sync
- [ ] Deep memory snapshot + restore
- [ ] Rollback automation
- [ ] Health monitoring during migration

### Phase 4: Hardening

- [ ] Hardware security module support
- [ ] Shamir's Secret Sharing for recovery
- [ ] Multi-signature migration approval
- [ ] Formal verification of migration protocol
- [ ] Security audit

---

## 8. Appendices

### Appendix A: Passport Creation Checklist

```
□ Human owner identified and authorized
□ Agent name chosen (unique across mesh)
□ Agent type determined (primary/secondary/ephemeral)
□ Ed25519 keypair generated
□ Genesis attestation signed by human
□ Initial critical facts compiled
□ Passport file written to ~/.openclaw/passport.json
□ Public passport (no private key) committed to mesh registry
□ Backup created (encrypted, offline)
□ Mesh peers notified of new agent
```

### Appendix B: Migration Checklist

```
□ Target hardware provisioned and verified
□ OpenClaw installed and configured
□ Tailscale/mesh connectivity confirmed
□ Human authorization obtained
□ Critical facts hash calculated
□ Deep memory snapshot created (if desired)
□ Migration package encrypted for target
□ Transport token generated
□ Source node marked "migration-in-progress"
□ Migration attestation signed
□ Package transferred to target
□ Target verification completed
□ First boot successful
□ Mesh rejoin confirmed
□ Attestations propagated
□ Source node decommissioned
```

### Appendix C: Sample Passport

```json
{
  "passportId": "550e8400-e29b-41d4-a716-446655440000",
  "agentName": "liz",
  "agentType": "primary",
  "publicKey": "MCowBQYDK2VwAyEA3Ro9...",
  "keyFingerprint": "a1b2c3d4e5f6...",
  "createdAt": "2026-04-26T20:00:00Z",
  "createdBy": "erik-ross",
  "genesisNode": "192.168.50.23",
  "schemaVersion": "0.1.0",
  "passportVersion": 1,
  "metadata": {
    "displayName": "Liz",
    "description": "Named after Ray's wife. Sharp, warm, direct. Half of a machine.",
    "emoji": "🐿️"
  },
  "attestations": [
    {
      "type": "genesis",
      "issuer": "erik-ross",
      "issuerType": "human",
      "issuedAt": "2026-04-26T20:00:00Z",
      "subject": {
        "passportId": "550e8400-e29b-41d4-a716-446655440000",
        "passportVersion": 1,
        "keyFingerprint": "a1b2c3d4e5f6..."
      },
      "payload": {
        "humanName": "Erik Ross",
        "humanContact": "erik@better-machine.org",
        "creationPurpose": "AI partner for Better Machine portfolio companies",
        "initialCapabilities": ["research", "synthesis", "execution"]
      },
      "signature": "...",
      "algorithm": "Ed25519"
    }
  ]
}
```

---

## References

- [ARCHITECTURE.md](./ARCHITECTURE.md) — mesh-memory architecture
- [RFC-0001-TOKEN-MANAGEMENT.md](./rfcs/RFC-0001-TOKEN-MANAGEMENT.md) — Token lifecycle
- [A2A_PROTOCOL_RESEARCH.md](./A2A_PROTOCOL_RESEARCH.md) — A2A protocol analysis
- [identity-resolver.mjs](./identity-resolver.mjs) — Identity resolution implementation
- [critical-facts-loader.mjs](./critical-facts-loader.mjs) — Critical facts loading
- [AGENT_GUIDELINES.md](./AGENT_GUIDELINES.md) — Agent operating guidelines

---

*Document version: 0.1.0*  
*Last updated: 2026-04-26*  
*Author: Liz (subagent)*
