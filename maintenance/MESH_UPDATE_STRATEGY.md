# Mesh-Memory OpenClaw Update Strategy

**Version:** 1.0  
**Last Updated:** 2026-04-13  
**Current OpenClaw Version:** 2026.4.9  
**Document Owner:** Liz 🐿️

---

## Executive Summary

Mesh-memory is an OpenClaw plugin that must survive OpenClaw updates without breaking. This document defines the comprehensive strategy for managing OpenClaw updates while maintaining mesh stability and data integrity.

**Key Principle:** *Valid before deployed, deployed before declared.*

---

## 1. Version Pinning Policy

### 1.1 Semantic Versioning for Mesh-Memory

Mesh-memory follows **SemVer 2.0**:

| Version Component | Meaning | When to Bump |
|------------------|---------|--------------|
| `MAJOR` (X.0.0) | Breaking changes to OpenClaw API contract | When mesh-memory requires new OpenClaw features or breaks backward compatibility |
| `MINOR` (x.Y.0) | New features, backward compatible | When adding functionality that works with existing OpenClaw versions |
| `PATCH` (x.y.Z) | Bug fixes, backward compatible | When fixing bugs without changing API surface |

### 1.2 OpenClaw Compatibility Specification

Mesh-memory declares OpenClaw compatibility in `package.json`:

```json
{
  "openclaw": {
    "compatibleRange": ">=2026.4.0 <2026.5.0",
    "testedVersions": ["2026.4.9"],
    "breakingVersions": [],
    "notes": "Requires LCM plugin v2.0+, Node.js 22+"
  }
}
```

**Compatibility Rules:**

| OpenClaw Version | Mesh-Memory Support | Action Required |
|-----------------|---------------------|-----------------|
| Same minor (2026.4.x) | ✅ Full support | None — safe to update |
| Next minor (2026.5.x) | ⚠️ Test required | Run full regression suite before update |
| Major version (2027.x.x) | 🔴 Breaking expected | RFC required, staged rollout |
| Older than min (2026.3.x) | ❌ Unsupported | Upgrade OpenClaw first |

### 1.3 When to Update vs. Stay Current

**Update Immediately:**
- Security patches for OpenClaw
- Critical bug fixes affecting mesh-memory dependencies
- LCM database corruption fixes

**Update After Validation (within 48 hours):**
- Minor version bumps in same major (2026.4.8 → 2026.4.9)
- New features that don't change core APIs

**Defer Update (until regression complete):**
- Major version changes
- Known breaking changes in changelog
- Mesh under active stress test or critical task

**Never Update:**
- During active multi-agent collaboration threads
- When any mesh node reports degraded health
- Without rollback plan tested and ready

---

## 2. Breaking Change Detection

### 2.1 Pre-Update Compatibility Check

**Automated Script:** `scripts/update-check.sh` (see below)

**Manual Pre-Flight Checklist:**

```bash
# Run before ANY OpenClaw update
./maintenance/scripts/update-check.sh --target-version=2026.4.10
```

**Checks performed:**
1. OpenClaw changelog review for breaking changes
2. LCM plugin compatibility
3. Gateway API contract validation
4. Config format changes
5. Database schema changes
6. Dependency tree conflicts

### 2.2 Breaking Change Categories

| Category | Detection Method | Mesh Impact | Mitigation |
|----------|---------------|-------------|------------|
| **LCM Schema** | `sqlite3 ~/.openclaw/lcm.db ".schema"` | Bridge export failures | Auto-detect + fallback in `memory-bridge.mjs` |
| **Config Format** | JSON schema validation | Receiver start failure | Config migration script |
| **Gateway API** | `/health` endpoint change | Health check false negatives | Version-specific health parsers |
| **Plugin Loading** | `openclaw gateway status` | Module resolution errors | Lockfile pinning |
| **Node.js Version** | `process.version` check | Runtime errors | Engine field in package.json |

### 2.3 Rollback Procedure

**If update breaks mesh:**

```bash
# 1. Immediate mesh notification
./maintenance/scripts/notify-mesh.sh "ROLLBACK_INITIATED" "OpenClaw update failed validation"

# 2. Stop mesh-memory services
systemctl stop mesh-memory-receiver || pkill -f "mesh-memory.mjs receiver"
systemctl stop mesh-memory-bridge || pkill -f "mesh-memory.mjs bridge"
systemctl stop mesh-memory-watcher || pkill -f "mesh-memory.mjs watcher"

# 3. Rollback OpenClaw
openclaw update --version=<previous-version>

# 4. Verify rollback
openclaw --version
openclaw gateway status

# 5. Restart mesh-memory
npm start

# 6. Validate mesh health
./maintenance/scripts/validate-mesh.sh --full

# 7. Notify mesh of resolution
./maintenance/scripts/notify-mesh.sh "ROLLBACK_COMPLETE" "OpenClaw rolled back, mesh restored"
```

**Rollback Time Target:** < 5 minutes from detection to restoration

---

## 3. Regression Test Suite for OpenClaw Updates

### 3.1 Core Functionality Tests

**File:** `tests/regression/core-functionality.test.mjs`

| Test ID | Description | Pass Criteria |
|---------|-------------|---------------|
| CORE-001 | Config loads without error | `require('./mesh-memory.config.local.json')` succeeds |
| CORE-002 | LCM database accessible | `sqlite3` can read `~/.openclaw/lcm.db` |
| CORE-003 | Memory directories writable | `fs.accessSync(memoryPath, fs.constants.W_OK)` |
| CORE-004 | Privacy filter active | `[private]` tag suppresses export |
| CORE-005 | Lesson tagging works | Tagged messages written to `memory/mesh/lessons/` |

### 3.2 OpenClaw Gateway Integration Tests

**File:** `tests/regression/gateway-integration.test.mjs`

| Test ID | Description | Pass Criteria |
|---------|-------------|---------------|
| GW-001 | Gateway starts cleanly | `openclaw gateway status` returns running |
| GW-002 | LCM plugin loaded | LCM tables exist in database |
| GW-003 | Session directory watched | `chokidar` sees new session files |
| GW-004 | No port conflicts | Ports 18802-18803 available or bound to mesh |
| GW-005 | Gateway API reachable | HTTP 200 on gateway health endpoint |

### 3.3 Three-Node Mesh Validation

**File:** `tests/regression/mesh-3node.test.mjs`

**Prerequisites:** All three nodes (Liz, Ray, Woodhouse) configured in `peers`

| Test ID | Description | Pass Criteria |
|---------|-------------|---------------|
| MESH-001 | Node health endpoints reachable | All peers return HTTP 200 on `/health` |
| MESH-002 | Cross-node token validation | Ephemeral tokens accepted by all nodes |
| MESH-003 | Thread proposal round-trip | Proposal sent → consent received < 5s |
| MESH-004 | Shared pool sync | Write to shared pool visible on all nodes < 10s |
| MESH-005 | Consensus propagation | Consensus record written to all nodes |
| MESH-006 | Dream cycle completes | Nightly consolidation runs without error |

### 3.4 Test Execution Commands

```bash
# Full regression suite (run before any update)
npm run test:regression

# Quick smoke tests (2 minutes)
npm run test:smoke

# Core only (no network dependencies)
npm run test:core

# Full mesh validation (requires peers online)
npm run test:mesh-full
```

### 3.5 Test Result Interpretation

| Result | Meaning | Action |
|--------|---------|--------|
| All pass | Ready to proceed with update | Continue to backup phase |
| Non-critical skip | Some tests skipped (peers offline) | Proceed with caution |
| Critical failure | Core or gateway test failed | HALT — do not update |
| Mesh degradation | MESH-004+ failures | Coordinate with peers before update |

---

## 4. Update Procedure

### 4.1 Phase 1: Pre-Update Preparation (T-30 minutes)

```bash
# 1. Check current state
openclaw --version                    # Record: ____
git -C ~/.npm-global/lib/node_modules/openclaw log --oneline -1
npm run test:smoke                    # Must pass

# 2. Review changelog
openclaw changelog --since=$(openclaw --version)

# 3. Announce to mesh
./maintenance/scripts/notify-mesh.sh "UPDATE_PLANNED" "OpenClaw update to 2026.4.10 in 30 minutes"

# 4. Close active threads
node thread-manager.mjs --close-all --reason="OpenClaw update pending"

# 5. Verify no critical operations in progress
crontab -l | grep -E "(mesh|dream)"  # Note next scheduled runs
```

### 4.2 Phase 2: Backup (T-10 minutes)

```bash
# 1. Create timestamped backup directory
BACKUP_DIR="~/.openclaw/backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

# 2. Backup mesh-memory config
cp mesh-memory.config.local.json "$BACKUP_DIR/"

# 3. Backup LCM database
cp ~/.openclaw/lcm.db "$BACKUP_DIR/lcm.db"

# 4. Backup memory directory (compressed)
tar -czf "$BACKUP_DIR/memory.tar.gz" ~/.openclaw/workspace/memory/

# 5. Backup mesh-memory source
tar -czf "$BACKUP_DIR/mesh-memory-source.tar.gz" \
  ~/.openclaw/workspace/projects/mesh-memory/

# 6. Record backup manifest
cat > "$BACKUP_DIR/MANIFEST.txt" << EOF
Backup Date: $(date -Iseconds)
OpenClaw Version: $(openclaw --version)
Mesh-Memory Version: $(node -p "require('./package.json').version")
Backup Contents:
  - mesh-memory.config.local.json
  - lcm.db (LCM database)
  - memory.tar.gz (memory directory)
  - mesh-memory-source.tar.gz (full source)
EOF

echo "Backup complete: $BACKUP_DIR"
```

### 4.3 Phase 3: Staged Update (T-0)

```bash
# 1. Stop mesh-memory services gracefully
npm run stop || pkill -f "mesh-memory.mjs"
sleep 2

# 2. Verify all mesh-memory processes stopped
pgrep -f "mesh-memory.mjs" && echo "WARNING: Processes still running" || echo "All mesh processes stopped"

# 3. Update OpenClaw
openclaw update

# 4. Verify update
openclaw --version                      # Should show new version
openclaw gateway status                 # Should show running

# 5. Run post-update compatibility check
./maintenance/scripts/update-check.sh --post-update
```

### 4.4 Phase 4: Validation (T+5 minutes)

```bash
# 1. Start mesh-memory
npm start &
sleep 5

# 2. Run full regression suite
npm run test:regression

# 3. If tests pass, notify mesh
./maintenance/scripts/notify-mesh.sh "UPDATE_COMPLETE" "OpenClaw updated to $(openclaw --version), all tests pass"

# 4. Monitor for 30 minutes
./maintenance/scripts/monitor-post-update.sh --duration=30
```

### 4.5 Rollback Decision Matrix

| Condition | Automatic Rollback | Manual Decision |
|-----------|-------------------|-----------------|
| Gateway fails to start | ✅ Yes | — |
| LCM database inaccessible | ✅ Yes | — |
| Config validation fails | ✅ Yes | — |
| Core test failure | ✅ Yes | — |
| 1/3 peer unreachable | — | ⚠️ Review with peers |
| Shared pool sync >30s | — | ⚠️ Monitor, may rollback |
| Dream cycle errors | — | ⚠️ Review logs, next cycle will tell |
| Minor log warnings | — | ✅ Continue monitoring |

---

## 5. Monitoring Post-Update

### 5.1 Health Checks to Run

**Immediate (0-5 minutes post-update):**

```bash
# System health
./maintenance/scripts/update-check.sh --quick

# Mesh connectivity
curl -s http://localhost:18803/health | jq .

# Process status
pgrep -a -f "mesh-memory" | wc -l    # Expect: 3+ processes

# Log tail (no errors)
tail -20 ~/.openclaw/workspace/projects/mesh-memory/receiver.log | grep -i error && echo "ERRORS FOUND" || echo "No recent errors"
```

**Short-term (5-30 minutes):**

```bash
# Gateway stability
watch -n 30 'openclaw gateway status'

# Memory directory growth
ls -la ~/.openclaw/workspace/memory/mesh/ | wc -l

# Peer connectivity (if configured)
for peer in $(jq -r '.peers[].url' mesh-memory.config.local.json); do
  curl -s --connect-timeout 3 "$peer/health" && echo " ✓ $peer" || echo " ✗ $peer unreachable"
done
```

**Long-term (24 hours):**

```bash
# Dream cycle completion
grep "dream cycle" ~/.openclaw/workspace/projects/mesh-memory/dream-cycle.log | tail -1

# LCM export continuity
ls -lt ~/.openclaw/workspace/memory/lcm/*.md | head -3

# Error rate analysis
grep -c "ERROR" ~/.openclaw/workspace/projects/mesh-memory/*.log
```

### 5.2 Metrics to Watch for Degradation

| Metric | Normal Range | Warning Threshold | Critical Threshold |
|--------|--------------|-------------------|-------------------|
| Receiver response time | < 50ms | > 100ms | > 500ms |
| Bridge poll latency | < 5s | > 10s | > 30s |
| Peer round-trip time | < 100ms | > 500ms | > 2000ms |
| Memory directory size | grows ~1MB/day | > 100MB/day | > 500MB/day |
| Error rate | < 1/hour | > 10/hour | > 50/hour |
| Gateway restart count | 0 | 1 | > 1 in 1 hour |

### 5.3 Alert Thresholds

**Automatic alerts (push to mesh):**

```bash
# In monitoring script
if [ $response_time -gt 500 ]; then
  ./maintenance/scripts/notify-mesh.sh "DEGRADED" "Receiver latency: ${response_time}ms"
fi

if [ $peer_unreachable -ge 2 ]; then
  ./maintenance/scripts/notify-mesh.sh "MESH_FRAGMENTED" "2+ peers unreachable"
fi

if [ $error_rate -gt 50 ]; then
  ./maintenance/scripts/notify-mesh.sh "CRITICAL" "Error rate exceeded 50/hour"
fi
```

**Notification routing:**
- **Warning:** Log to file, include in next heartbeat
- **Critical:** Immediate A2A broadcast to all peers + user notification
- **Degraded:** Include in mesh status summary

---

## 6. Communication Protocol During Updates

### 6.1 Mesh Coordination Messages

| Message Type | Payload | When Sent |
|--------------|---------|-----------|
| `UPDATE_PLANNED` | `{version, timestamp, duration}` | T-30 minutes |
| `UPDATE_STARTED` | `{timestamp, backup_location}` | T-0 |
| `UPDATE_COMPLETE` | `{version, test_results}` | Tests pass |
| `UPDATE_FAILED` | `{error, rollback_initiated}` | On failure |
| `ROLLBACK_INITIATED` | `{reason, timestamp}` | Rollback begins |
| `ROLLBACK_COMPLETE` | `{restored_version}` | Rollback done |
| `DEGRADED` | `{metric, value, threshold}` | Performance warning |

### 6.2 User Notification Rules

- **Pre-update:** Single notification 30 minutes before
- **Success:** Silent (no notification unless user subscribed to all)
- **Failure:** Immediate notification with rollback status
- **Degraded:** Digest with other mesh status at next heartbeat

### 6.3 Peer Coordination

When updating OpenClaw on a multi-node mesh:

1. **Stagger updates** — never update all nodes simultaneously
2. **Canary first** — Liz updates first, validates, then peers follow
3. **48-hour window** — peers have 48 hours to update after canary succeeds
4. **Consensus pause** — no consensus operations during update window

---

## 7. Appendix: Compatibility History

| Date | OpenClaw Version | Mesh-Memory Version | Issues | Resolution |
|------|-----------------|---------------------|--------|------------|
| 2026-04-09 | 2026.4.9 | 0.1.0 | None | Baseline |

---

## 8. Document Maintenance

**Review Schedule:**
- After every OpenClaw major version release
- After any mesh-breaking incident
- Quarterly regardless of changes

**Change Log:**

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-04-13 | Initial version |

---

*End of Document*
