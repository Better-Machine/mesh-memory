# Identity Passport CLI Design

**Status:** Draft  
**Author:** Liz (with Architecture Review insights)  
**Date:** 2026-04-26  
**Version:** 0.1.0

---

## Overview

Command-line interface for managing cryptographic agent passports across the mesh-memory ecosystem. Enables creation, migration, attestation workflows, and mesh-wide identity verification.

---

## Command Structure

```
openclaw passport <command> [options]
```

### Top-Level Commands

| Command | Description |
|---------|-------------|
| `create` | Generate new passport with Ed25519 keypair |
| `export` | Export passport for backup/migration |
| `import` | Import passport from backup or another agent |
| `rotate-keys` | Generate new keypair (with attestation chain) |
| `migrate` | Full migration workflow (export → transfer → import) |
| `attest` | Create attestation for another agent |
| `verify-peer` | Verify another agent's identity |
| `registry` | Manage local and mesh-wide passport registry |
| `status` | Display current passport and key info |

---

## Command Specifications

### `openclaw passport create`

Create a new agent passport with genesis attestation.

```bash
openclaw passport create \
  --name "Liz-Backup" \
  --type secondary \
  --created-by "erik@example.com" \
  --description "Backup agent for distributed operations" \
  --output ~/.openclaw/passport.json \
  --private-key ~/.openclaw/passport.key
```

**Interactive Flow (when run without args):**

```
$ openclaw passport create

Agent Name: Liz-Backup
Agent Type [secondary]: 
Creator Email/Name: erik@example.com
Description: Backup agent for distributed operations
Save passport to [~/.openclaw/passport.json]: 
Save private key to [~/.openclaw/passport.key]: 

🔐 Creating Ed25519 keypair...
✅ Passport created: 550e8400-e29b-41d4-a716-446655440000
📜 Genesis attestation signed by self
🔑 Fingerprint: a1b2c3d4e5f678901234...

⚠️  IMPORTANT: Store private key securely. Loss = identity loss.
```

**Output Files:**

| File | Content | Permissions |
|------|---------|-------------|
| `passport.json` | Public passport data (no private key) | 644 |
| `passport.key` | Encrypted private key (AES-256-GCM) | 600 |

---

### `openclaw passport export`

Export passport for backup or migration.

```bash
openclaw passport export \
  --passport ~/.openclaw/passport.json \
  --private-key ~/.openclaw/passport.key \
  --format encrypted-bundle \
  --output liz-backup-$(date +%Y%m%d).enc
```

**Formats:**

| Format | Description | Use Case |
|--------|-------------|----------|
| `public-only` | Just the passport JSON | Sharing identity for verification |
| `encrypted-bundle` | Passport + encrypted private key | Full backup/migration |
| `qr-code` | Visual QR representation | Air-gapped transfer |

**Migration Attestation:**

When exporting with `--migration` flag, creates a migration attestation signed by current key:

```json
{
  "type": "migration",
  "issuer": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2026-04-26T21:30:00Z",
  "signature": "...",
  "payload": {
    "fromNode": "192.168.50.23",
    "toNode": "192.168.50.24",
    "reason": "Hardware upgrade"
  }
}
```

---

### `openclaw passport import`

Import passport from backup or another agent.

```bash
openclaw passport import \
  --input liz-backup-20260426.enc \
  --passport ~/.openclaw/passport.json \
  --private-key ~/.openclaw/passport.key \
  --verify-attestations
```

**Verification Steps:**

1. Validate passport schema version
2. Verify all attestations (genesis + any migrations)
3. Check key fingerprint matches attestations
4. Import into local registry

---

### `openclaw passport rotate-keys`

Generate new Ed25519 keypair while preserving passport identity.

```bash
openclaw passport rotate-keys \
  --passport ~/.openclaw/passport.json \
  --reason "Quarterly security rotation"
```

**Process:**

1. Generate new keypair
2. Sign rotation attestation with OLD key
3. Sign rotation attestation with NEW key
4. Update passport with new public key
5. Archive old key (for verifying old signatures)

**Key History Entry:**

```json
{
  "version": 1,
  "fingerprint": "old-fingerprint",
  "rotatedAt": "2026-04-26T21:30:00Z",
  "rotationAttestation": "...",
  "reason": "Quarterly security rotation"
}
```

---

### `openclaw passport migrate`

Full migration workflow for hardware/platform transitions.

```bash
openclaw passport migrate \
  --source-node liz-primary \
  --target-node liz-secondary \
  --method a2a
```

**Interactive Migration Flow:**

```
$ openclaw passport migrate

🔍 Detecting current passport... Found: Liz (550e84...)

Target Node Options:
  1. liz-secondary (192.168.50.24) ✓ reachable
  2. woodhouse-node (192.168.50.24)
  3. Manual entry

Select target [1]: 1

Migration Method:
  1. A2A secure transfer (encrypted)
  2. Export file + manual transfer
  3. QR code (air-gapped)

Select method [1]: 1

🔄 Initiating migration via A2A to liz-secondary...
📦 Exporting encrypted bundle...
🔐 Sending via secure A2A channel...
✅ Target confirmed receipt
📝 Creating migration attestation...
✅ Migration complete. Passport now active on liz-secondary.

⚠️  You may now retire this node's passport copy.
```

---

### `openclaw passport attest`

Create attestation for another agent (trust establishment).

```bash
openclaw passport attest \
  --subject-passport 550e8400-e29b-41d4-a716-446655440000 \
  --type trust-establishment \
  --level high \
  --relationship "peer-collaborator" \
  --expires 2027-04-26
```

**Attestation Types:**

| Type | Purpose | Typical Issuer |
|------|---------|----------------|
| `genesis` | Initial creation | Human owner |
| `trust-establishment` | Peer trust | Another agent |
| `migration` | Hardware move | Self (old key) |
| `key-rotation` | Key update | Self (both keys) |
| `revocation` | Revoke trust | Original issuer |

---

### `openclaw passport verify-peer`

Verify another agent's identity and trustworthiness.

```bash
openclaw passport verify-peer \
  --passport-id 550e8400-e29b-41d4-a716-446655440000 \
  --require-attestations 2 \
  --min-trust-level medium
```

**Verification Output:**

```
🔍 Verifying peer: Ray (550e84...)

Identity Verification:
  ✅ Passport found in registry
  ✅ Public key valid Ed25519
  ✅ Genesis attestation verified (signed by erik@example.com)
  ✅ 2 trust attestations from mesh peers
  ✅ No revocations found

Trust Score: 0.87 (HIGH)

Attestation Chain:
  1. genesis (2026-03-15) — erik@example.com ✓
  2. trust-establishment (2026-03-20) — Liz ✓
  3. trust-establishment (2026-03-22) — Woodhouse ✓

Recommendation: ✅ ACCEPT — High trust, established identity
```

---

### `openclaw passport registry`

Manage local and mesh-wide passport registry.

```bash
# List all known passports
openclaw passport registry list

# Sync with mesh registry
openclaw passport registry sync --via-a2a

# Query specific passport
openclaw passport registry query 550e84...

# Remove stale entry
openclaw passport registry remove 550e84... --reason "revoked"
```

---

### `openclaw passport status`

Display current passport health and info.

```bash
$ openclaw passport status

📋 Passport Status: Liz
═══════════════════════════════════════════

Identity:
  Passport ID: 550e8400-e29b-41d4-a716-446655440000
  Agent Name: Liz
  Type: primary
  Created: 2026-03-15T09:23:00Z
  Genesis Node: 192.168.50.23

Cryptographic:
  Algorithm: Ed25519
  Key Version: 1
  Fingerprint: a1b2c3d4e5f67890...
  Key Age: 42 days

Attestations: 5 total
  - 1 genesis (verified)
  - 1 migration (verified)
  - 3 trust-establishment (verified)

Trust Score: 0.92 (HIGH)
Mesh Peers: 2 verified connections

⚠️  Key rotation recommended (age > 90 days)
```

---

## File Formats

### Passport File (Public)

```json
{
  "passportId": "550e8400-e29b-41d4-a716-446655440000",
  "agentName": "Liz",
  "agentType": "primary",
  "publicKey": "base64-encoded-der...",
  "keyFingerprint": "a1b2c3d4e5f678901234...",
  "createdAt": "2026-03-15T09:23:00Z",
  "createdBy": "erik@example.com",
  "genesisNode": "192.168.50.23",
  "schemaVersion": "0.1.0",
  "passportVersion": 1,
  "metadata": {
    "displayName": "Liz",
    "emoji": "🐿️",
    "description": "Agent for distributed operations"
  },
  "keyHistory": [],
  "attestations": [
    {
      "type": "genesis",
      "issuer": "erik@example.com",
      "issuerType": "human",
      "timestamp": "2026-03-15T09:23:00Z",
      "signature": "...",
      "payload": {
        "creationPurpose": "Agent for distributed operations",
        "initialCapabilities": []
      }
    }
  ]
}
```

### Private Key File

Encrypted with AES-256-GCM, key derived from platform keychain or passphrase:

```json
{
  "version": 1,
  "algorithm": "aes-256-gcm",
  "salt": "base64...",
  "iv": "base64...",
  "ciphertext": "base64...",
  "tag": "base64...",
  "passportId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### Encrypted Bundle (Export/Import)

```json
{
  "version": 1,
  "format": "encrypted-bundle",
  "createdAt": "2026-04-26T21:30:00Z",
  "passport": { /* ... full passport ... */ },
  "privateKey": { /* encrypted private key */ },
  "migrationAttestation": { /* optional */ }
}
```

---

## Integration with A2A

### Message Signing

```bash
# Send A2A message with passport signature
openclaw a2a send \
  --peer Ray \
  --message "Hello from Liz" \
  --sign-with-passport ~/.openclaw/passport.json \
  --private-key ~/.openclaw/passport.key
```

### Verification

```bash
# Verify incoming A2A message signature
openclaw a2a verify \
  --message-file incoming.json \
  --require-signature
```

---

## Security Considerations

### Private Key Protection

1. **At Rest:** AES-256-GCM encryption
2. **In Transit:** TLS for A2A, encrypted bundles for export
3. **In Memory:** Cleared after use, never logged
4. **Backup:** Split-key or hardware security module (future)

### Attestation Verification

**⚠️ CRITICAL:** Attestation verification must use **issuer's** public key, not subject's key. Current implementation has this bug (see security fix required).

### Migration Security

1. Migration attestations prevent replay attacks
2. Source node should retire key after successful migration
3. Mesh registry updated atomically

---

## Implementation Priority

| Phase | Commands | Timeline |
|-------|----------|----------|
| P1 | `create`, `export`, `import`, `status` | Week 1 |
| P2 | `migrate`, `rotate-keys` | Week 2 |
| P3 | `attest`, `verify-peer`, `registry` | Week 3 |
| P4 | A2A integration, mesh sync | Week 4 |

---

## Related Documents

- `IDENTITY_ARCHITECTURE.md` — Core identity system design
- `a2a-identity-integration.md` — A2A message signing protocol
- `MIGRATION-STANDARDS.md` — Cross-agent migration procedures
