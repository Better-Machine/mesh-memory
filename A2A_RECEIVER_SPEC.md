# A2A Receiver Specification — Peer Verification & Trust Protocol

**Status:** Draft (RFC-0000 companion)  
**Author:** Liz (Agentic Identity & Trust Architect)  
**Date:** 2026-04-11  
**Scope:** All A2A mesh nodes (Liz .23, Ray .22, Woodhouse .24)  

---

## Executive Summary

This document specifies the **peer verification protocol, receiver connectivity requirements, and deployment validation procedures** for the A2A mesh. It addresses the root cause of the mesh's connectivity failures: the gap between "A2A message acknowledged" and "node actually reachable."

**The core problem:** A2A messages succeed at the protocol layer while HTTP health checks fail at the transport layer. This creates false confidence in mesh topology and leads to phantom node syndrome.

---

## 1. Peer Verification Protocol

### 1.1 Identity Attestation

Each node in the mesh MUST have a **stable identity** composed of:

| Attribute | Source | Persistence |
|-----------|--------|-------------|
| `agentId` | `mesh-memory.config.local.json` | Config file |
| `nodeId` | Derived: `hash(agentId + hardware_fingerprint)` | Hardware-bound |
| `ipAddress` | Runtime discovery (static assignment preferred) | Network config |
| `a2aPort` | `openclaw.json` → `server.port` (default 18800) | Config file |
| `receiverPort` | `mesh-memory.config.local.json` → `receiverPort` (default 18803) | Config file |
| `publicKey` | Ed25519 key pair (optional, for future) | Key store |

**Identity Resolution Order:**
1. Static IP from config (preferred for stability)
2. mDNS hostname resolution (ray-node, woodhouse-node, liz-node)
3. Fallback to last known good IP (with staleness check)

**Required: `/etc/hosts` entries on ALL nodes:**
```
192.168.50.22  ray-node
192.168.50.23  liz-node
192.168.50.24  woodhouse-node
```

### 1.2 Health Verification Contract

Before any node claims another is "operational," it MUST verify:

#### L1: A2A Gateway Health (Port 18800)
```bash
GET http://{peer-ip}:18800/.well-known/agent.json
```
**Expected:**
- HTTP 200 OK
- Response time < 500ms
- Valid JSON with `name`, `url`, `skills` fields
- `url` field matches expected endpoint

#### L2: Mesh-Memory Receiver Health (Port 18803)
```bash
GET http://{peer-ip}:18803/health
Authorization: Bearer {receiverToken}
```
**Expected:**
- HTTP 200 OK or 401 Unauthorized (both prove endpoint is alive)
- Response time < 2000ms
- Response body: `{ "status": "ok" }` (200) or error (401)

**Critical distinction:**
- HTTP 200 with `{status: "ok"}` → Receiver fully operational
- HTTP 401 → Receiver is alive but auth failed (still proves reachability)
- Connection refused / timeout → Receiver NOT operational (regardless of A2A status)

#### L3: Deep Health (Optional — for capacity planning)
```bash
GET http://{peer-ip}:18800/a2a/metrics
Authorization: Bearer {a2aToken}
```
**Returns:**
```json
{
  "gateway": "ok",
  "taskQueue": {"active": 2, "capacity": 4},
  "receiverHealth": "ok" | "unreachable" | "degraded"
}
```

### 1.3 Verification Protocol Flow

```
Node A wants to send to Node B

Step 1: Resolve B's identity
  → Look up B in local peers.json
  → Get B's IP, ports, tokens

Step 2: L1 Health Check (A2A Gateway)
  GET /.well-known/agent.json
  ↓
  [Timeout/Refused] → Mark B as UNREACHABLE, abort send
  [HTTP 200 OK]     → L1 passed, continue to L2

Step 3: L2 Health Check (Mesh Receiver)
  GET /health with Bearer token
  ↓
  [Timeout/Refused] → Mark B as "A2A only" — A2A messages work
                        but shared-pool/memory events will fail
  [HTTP 401]        → L2 passed (receiver alive, auth layer reachable)
  [HTTP 200 OK]     → L2 passed, full mesh capability confirmed

Step 4: Proceed with send or queue for retry
```

**State Machine:**

| State | L1 | L2 | Meaning | Action |
|-------|----|----|---------|--------|
| `unreachable` | ✗ | — | Node down | Don't send; alert |
| `a2a-only` | ✓ | ✗ | Gateway up, receiver down | Send A2A only; no mesh-memory |
| `operational` | ✓ | ✓/401 | Full capability | Send all |
| `degraded` | ✓ | 401 | Auth misconfig | Send A2A; flag token mismatch |

### 1.4 Trust Scoring Model

Each node maintains a **trust ledger** for every peer:

```typescript
interface TrustScore {
  peerId: string;
  currentScore: number;      // 0.0 - 1.0
  consecutiveFailures: number;
  lastSuccessAt: timestamp;
  lastFailureAt: timestamp;
  failureHistory: Array<{    // Last 20 entries
    timestamp: timestamp;
    type: "timeout" | "refused" | "auth" | "5xx";
    duration: number;        // How long before failure
  }>;
  circuitState: "closed" | "open" | "half-open";
}
```

**Scoring Algorithm:**

```
Initial score: 1.0

On successful health check (any L2 response):
  score = min(1.0, score + 0.1)
  consecutiveFailures = 0

On failed health check:
  consecutiveFailures += 1
  score = max(0.0, score - (0.2 * consecutiveFailures))

Circuit breaker rules:
  IF consecutiveFailures >= 3:
    circuitState = "open"
    cooldownPeriod = 30s * (2 ^ consecutiveFailures)  // exponential backoff
  
  IF circuitState = "open" AND cooldownPeriod elapsed:
    circuitState = "half-open"
    Allow 1 probe health check
    
  IF probe succeeds:
    circuitState = "closed"
    score = 0.5  // partial recovery
  
  IF probe fails:
    circuitState = "open"
    consecutiveFailures += 1
```

**Trust Score Usage:**

| Score | Meaning | Routing Decision |
|-------|---------|------------------|
| 1.0 | Fully trusted | Normal routing |
| 0.7-0.9 | Degraded | Retry with backoff |
| 0.3-0.6 | Unreliable | Circuit open; queue messages |
| 0.0-0.2 | Failed | Don't route; alert operator |

---

## 2. Receiver Connectivity Specification

### 2.1 Bind Address Requirements

**CRITICAL: Receivers MUST bind to `0.0.0.0`, NOT `localhost` or `127.0.0.1`**

This is the #1 cause of "A2A works but HTTP fails" bugs.

**Verification:**
```bash
# On the node running the receiver:
ss -tlnp | grep 18803

# CORRECT output:
LISTEN 0 511 *:18803 *:* users:(("node",pid=...,fd=...))

# WRONG output (localhost-bound):
LISTEN 0 511 127.0.0.1:18803 *:* users:(("node",pid=...,fd=...))
```

**In code (memory-receiver.mjs):**
```javascript
// Currently uses default Express behavior (binds to 0.0.0.0)
// Explicitly specify for clarity:
const srv = app.listen(port, '0.0.0.0', () => {
  console.log(`[receiver] Listening on 0.0.0.0:${port}`);
});
```

### 2.2 Health Endpoint Contract

All receivers MUST implement:

```
GET /health
```

**Response Codes:**
- `200 OK` — Service healthy
- `401 Unauthorized` — Service alive, auth required (valid for reachability proof)
- `503 Service Unavailable` — Service starting up or degraded

**Response Body (200 only):**
```json
{
  "status": "ok",
  "agentId": "liz",           // Optional but recommended
  "timestamp": "2026-04-11T20:43:00Z",
  "version": "1.0.0"
}
```

**Error Body (503):**
```json
{
  "status": "degraded",
  "reason": "task_queue_saturated"
}
```

### 2.3 Firewall Rules for Inter-Node Communication

**Required open ports between mesh nodes:**

| Port | Protocol | Purpose | Direction |
|------|----------|---------|-----------|
| 18800 | TCP | A2A Gateway (JSON-RPC/REST) | Bidirectional |
| 18801 | TCP | A2A gRPC (port+1) | Bidirectional |
| 18802 | TCP | Thread Manager | Optional, local only |
| 18803 | TCP | Mesh-Memory Receiver | Bidirectional |

**Firewall configuration (Ubuntu/iptables):**
```bash
# Allow from mesh subnet only
iptables -A INPUT -p tcp -s 192.168.50.0/24 --dport 18800 -j ACCEPT
iptables -A INPUT -p tcp -s 192.168.50.0/24 --dport 18801 -j ACCEPT
iptables -A INPUT -p tcp -s 192.168.50.0/24 --dport 18803 -j ACCEPT
iptables -A INPUT -p tcp --dport 18800 -j DROP
iptables -A INPUT -p tcp --dport 18801 -j DROP
iptables -A INPUT -p tcp --dport 18803 -j DROP
```

**UFW (simpler):**
```bash
ufw allow from 192.168.50.0/24 to any port 18800,18801,18803 proto tcp
```

### 2.4 Systemd Service Requirements

**Every receiver MUST run as a managed systemd service.** No bare processes.

**Liz (Ubuntu) — mesh-memory.service:**
```ini
[Unit]
Description=mesh-memory — per-message cross-agent memory mesh
After=network.target
Wants=network.target

[Service]
Type=simple
WorkingDirectory=/home/erik-ross/.openclaw/workspace/projects/mesh-memory
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10
StartLimitInterval=60
StartLimitBurst=3

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/home/erik-ross/.openclaw/workspace/projects/mesh-memory

Environment=NODE_ENV=production
Environment=HOME=/home/erik-ross

[Install]
WantedBy=default.target
```

**Ray (Ubuntu) — Create this:**
```bash
# /home/erik-ross/.config/systemd/user/mesh-memory.service
# Same content as Liz

systemctl --user daemon-reload
systemctl --user enable mesh-memory
systemctl --user start mesh-memory
```

**Woodhouse (macOS) — Create this:**
```xml
<!-- ~/Library/LaunchAgents/com.bettermachine.mesh-memory.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.bettermachine.mesh-memory</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/node</string>
        <string>/Users/woodhouse/.openclaw/workspace/projects/mesh-memory/memory-receiver.mjs</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/woodhouse/.openclaw/workspace/projects/mesh-memory</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/mesh-memory.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/mesh-memory.error.log</string>
</dict>
</plist>

launchctl load ~/Library/LaunchAgents/com.bettermachine.mesh-memory.plist
launchctl start com.bettermachine.mesh-memory
```

**Health check for systemd:**
```ini
[Service]
ExecStartPost=/bin/sh -c 'sleep 2 && curl -sf http://localhost:18803/health || exit 1'
```

---

## 3. Deployment Validation Checklist

### 3.1 Individual Validation (Per-Node)

**Before claiming "ready," each node MUST:**

```markdown
## Pre-Deployment Checklist — Node: {agentId}

### Local Services
- [ ] A2A Gateway running: `openclaw gateway status` shows "running"
- [ ] A2A health responds: `curl -s http://localhost:18800/.well-known/agent.json` returns JSON
- [ ] Mesh-memory receiver running: `systemctl --user status mesh-memory` shows "active (running)"
- [ ] Receiver health responds: `curl -s http://localhost:18803/health` returns 200 or 401
- [ ] Receiver binds to 0.0.0.0: `ss -tlnp | grep 18803` shows `*:18803`, NOT `127.0.0.1:18803`

### Configuration
- [ ] `mesh-memory.config.local.json` exists and is valid JSON
- [ ] `agentId` is set to unique name (liz/ray/woodhouse)
- [ ] `receiverToken` is generated (24 bytes hex)
- [ ] `receiverPort` is set (18803)
- [ ] All peer entries have valid `receiverUrl` and `receiverToken`

### Network
- [ ] Firewall allows 18800, 18803 from 192.168.50.0/24
- [ ] `/etc/hosts` contains entries for all peer nodes

### Filesystem
- [ ] `~/.openclaw/workspace/memory/mesh/` directory exists and is writable
- [ ] `~/.openclaw/workspace/memory/shared/gates/` directory exists and is writable

Sign-off: _____________ Date: _____________
```

### 3.2 Collective Validation (Post-Deploy)

**Within 5 minutes of deployment, EACH node MUST verify ALL peers:**

```bash
#!/bin/bash
# validate-mesh.sh — Run on each node after deployment

PEERS=(
  "ray:192.168.50.22:18800:18803"
  "liz:192.168.50.23:18800:18803"
  "woodhouse:192.168.50.24:18800:18803"
)

MY_NODE="liz"  # Set per node
TOKEN_FILE="~/.openclaw/workspace/projects/mesh-memory/mesh-memory.config.local.json"
TOKEN=$(jq -r '.receiverToken' "$TOKEN_FILE")

FAILED=0

for peer in "${PEERS[@]}"; do
  IFS=':' read -r name a2a_port receiver_port ip <<< "$peer"
  
  echo "=== Checking $name ($ip) ==="
  
  # L1: A2A Gateway
  echo -n "L1 (A2A Gateway): "
  if curl -sf --max-time 5 "http://$ip:$a2a_port/.well-known/agent.json" > /dev/null; then
    echo "✓ OK"
  else
    echo "✗ FAIL"
    FAILED=1
  fi
  
  # L2: Mesh Receiver
  echo -n "L2 (Mesh Receiver): "
  RESPONSE=$(curl -sf --max-time 5 "http://$ip:$receiver_port/health" \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo "")
  
  if [ -n "$RESPONSE" ]; then
    echo "✓ OK (response received)"
  else
    # Try without auth to see if it's just auth issue
    STATUS=$(curl -s --max-time 5 -w "%{http_code}" "http://$ip:$receiver_port/health" -o /dev/null)
    if [ "$STATUS" = "401" ]; then
      echo "✓ OK (401 = reachable, auth expected)"
    else
      echo "✗ FAIL (timeout/refused)"
      FAILED=1
    fi
  fi
  
  echo ""
done

if [ $FAILED -eq 0 ]; then
  echo "✓✓✓ All peers reachable. Mesh is operational."
  exit 0
else
  echo "✗✗✗ Some peers unreachable. DO NOT declare mesh operational."
  exit 1
fi
```

### 3.3 State Definitions

**Separate these states explicitly:**

| State | Definition | Verification |
|-------|------------|------------|
| **Deployed** | Code is on disk, systemd service exists | `systemctl status` shows loaded |
| **Running** | Process is alive | `ss -tlnp` shows listening socket |
| **Reachable** | Other nodes can connect | Cross-node curl succeeds |
| **Operational** | All peers reachable, trust scores healthy | Collective validation passes |

**Golden Rule:**
> "Agent confirmed understanding" and "deployment is live and reachable" are different states. Track them separately. Deployed is not done. Validated is done.

---

## 4. Implementation Status

### Current State (2026-04-11)

| Node | L1 (A2A 18800) | L2 (Receiver 18803) | Systemd | Bind |
|------|----------------|---------------------|---------|------|
| Liz (.23) | ✓ | ✓ (running, auth required) | ✓ (active) | ✓ (0.0.0.0) |
| Ray (.22) | ✓ | ✗ (timeout from Liz) | ? | ? (suspected localhost) |
| Woodhouse (.24) | ✗ (refused) | ✗ (refused) | ? | ? |

### Required Actions

1. **Ray:** Verify receiver bind address; install systemd service if missing
2. **Woodhouse:** Debug A2A gateway startup; install launchd service for receiver
3. **All nodes:** Add `/etc/hosts` entries for peer resolution
4. **All nodes:** Run collective validation script

---

## 5. References

- `plugins/a2a-gateway/openclaw.plugin.json` — A2A gateway configuration schema
- `plugins/a2a-gateway/index.ts` — Gateway implementation with health manager
- `projects/mesh-memory/memory-receiver.mjs` — Receiver implementation
- `projects/mesh-memory/LIZ-A2A-ANALYSIS.md` — Root cause analysis
- `projects/mesh-memory/DEPLOY.md` — Deployment procedures
- AGENTS.md — Standing rule: Receivers must run as managed service

---

*Document version: 1.0 — 2026-04-11*  
*Next review: After Ray and Woodhouse receivers verified operational*
