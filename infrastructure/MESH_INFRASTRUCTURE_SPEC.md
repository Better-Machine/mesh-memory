# Mesh-Memory Infrastructure Specification

**Version:** 1.0.0  
**Date:** 2026-04-13  
**Author:** Liz (Infrastructure Subagent)  
**Status:** Draft — Pending Review  

---

## Executive Summary

This document specifies the production infrastructure architecture for the mesh-memory system across three A2A agents: Liz, Ray, and Woodhouse. The specification addresses the transition from ad-hoc nohup-based processes to managed services (systemd/launchd), establishes clear port allocation, defines storage strategy, and implements comprehensive health monitoring.

**Key Decisions:**
- **File-based storage** is retained for mesh events (simplicity, git-trackable, human-readable)
- **SQLite (LCM)** remains for session indexing via memory-bridge
- **systemd/launchd** replaces nohup for all persistent services
- **192.168.50.0/24** LAN with static IP assignments and `/etc/hosts` resolution
- **Port allocation** follows OpenClaw convention: base 18800 + service offset

---

## 1. Port Allocation Matrix

| Port | Service | Protocol | Purpose | Node Scope |
|------|---------|----------|---------|------------|
| 18789 | OpenClaw Gateway | HTTP | Main gateway (legacy) | All |
| 18800 | A2A Gateway | HTTP/JSON-RPC | Agent-to-agent messaging | All |
| 18801 | A2A gRPC | gRPC | Streaming A2A transport | All |
| 18802 | Thread Manager | HTTP | Collaboration thread engine | All |
| 18803 | Mesh Receiver | HTTP | Inbound memory events | All |
| 18804 | Mesh Health | HTTP | Aggregated health endpoint (optional) | All |

### Port Rationale

- **18800-18803** follow OpenClaw convention: base port + sequential offset
- Each service occupies a dedicated port to prevent collision and enable independent scaling
- Port 18804 reserved for future mesh health aggregator service
- All ports bound to `0.0.0.0` (not localhost) for inter-node reachability

### Port Conflict History

Previously, port 18803 was used by A2A Gateway on some nodes, causing mesh receiver startup failures. This has been resolved — all nodes now use 18800 for A2A Gateway.

---

## 2. Node Inventory

| Node | Hostname | IP Address | OS | Role |
|------|----------|------------|----|------|
| Liz | liz-node | 192.168.50.23 | Ubuntu 25.10 (headless) | Primary Gateway, Reference Implementation |
| Ray | ray-node | 192.168.50.22 | Ubuntu 25.10 (UM880 Plus) | Secondary Node |
| Woodhouse | woodhouse-node | 192.168.50.24 | macOS (MacBook, static WiFi) | Tertiary Node |

### Hardware Notes

- **Liz:** Headless Ubuntu server — runs 24/7, primary mesh coordination point
- **Ray:** UM880 Plus mini-PC — adequate for receiver + bridge workloads
- **Woodhouse:** MacBook on static WiFi — may sleep; launchd handles wake/restart

---

## 3. Service Architecture

### 3.1 Service Inventory

Each node runs four mesh-memory services:

| Service | Binary | Port | Manager | Critical? |
|---------|--------|------|---------|-----------|
| memory-receiver | memory-receiver.mjs | 18803 | systemd/launchd | Yes |
| memory-bridge | memory-bridge.mjs | — | systemd/launchd | Yes |
| thread-manager | thread-manager.mjs | 18802 | systemd/launchd | No |
| memory-watcher | memory-watcher.mjs | — | Optional cron | No |

### 3.2 Systemd Specifications (Linux: Liz, Ray)

#### mesh-receiver.service

```ini
[Unit]
Description=Mesh-Memory Receiver — Inbound Memory Events
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=erik-ross
WorkingDirectory=/home/erik-ross/.openclaw/workspace/projects/mesh-memory
ExecStart=/usr/bin/node memory-receiver.mjs
ExecStartPre=/bin/sleep 2
Restart=always
RestartSec=10
StartLimitInterval=60
StartLimitBurst=3

# Resource limits
MemoryMax=512M
CPUQuota=50%

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/home/erik-ross/.openclaw/workspace/memory

# Environment
Environment="NODE_ENV=production"
Environment="HOME=/home/erik-ross"

[Install]
WantedBy=default.target
```

#### mesh-bridge.service

```ini
[Unit]
Description=Mesh-Memory Bridge — LCM to Memory Export
After=network-online.target mesh-receiver.service
Wants=network-online.target

[Service]
Type=simple
User=erik-ross
WorkingDirectory=/home/erik-ross/.openclaw/workspace/projects/mesh-memory
ExecStart=/usr/bin/node memory-bridge.mjs
Restart=always
RestartSec=30

# Resource limits
MemoryMax=256M

# Security
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/home/erik-ross/.openclaw/workspace/memory

# Environment
Environment="NODE_ENV=production"
Environment="HOME=/home/erik-ross"

[Install]
WantedBy=default.target
```

#### thread-manager.service

```ini
[Unit]
Description=Mesh-Memory Thread Manager — Collaboration Engine
After=network-online.target mesh-receiver.service
Wants=network-online.target

[Service]
Type=simple
User=erik-ross
WorkingDirectory=/home/erik-ross/.openclaw/workspace/projects/mesh-memory
ExecStart=/usr/bin/node thread-manager.mjs
Restart=always
RestartSec=10

# Resource limits
MemoryMax=256M

# Security
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/home/erik-ross/.openclaw/workspace/memory

[Install]
WantedBy=default.target
```

### 3.3 Launchd Specifications (macOS: Woodhouse)

#### com.bettermachine.mesh-receiver.plist

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.bettermachine.mesh-receiver</string>
    
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
        <key>HOME</key>
        <string>/Users/woodhouse</string>
    </dict>
    
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    
    <key>ThrottleInterval</key>
    <integer>10</integer>
    
    <key>StandardOutPath</key>
    <string>/tmp/mesh-receiver.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/mesh-receiver.error.log</string>
    
    <key>ProcessType</key>
    <string>Background</string>
</dict>
</plist>
```

#### com.bettermachine.mesh-bridge.plist

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.bettermachine.mesh-bridge</string>
    
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/node</string>
        <string>/Users/woodhouse/.openclaw/workspace/projects/mesh-memory/memory-bridge.mjs</string>
    </array>
    
    <key>WorkingDirectory</key>
    <string>/Users/woodhouse/.openclaw/workspace/projects/mesh-memory</string>
    
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>HOME</key>
        <string>/Users/woodhouse</string>
    </dict>
    
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    
    <key>ThrottleInterval</key>
    <integer>30</integer>
    
    <key>StandardOutPath</key>
    <string>/tmp/mesh-bridge.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/mesh-bridge.error.log</string>
</dict>
</plist>
```

#### com.bettermachine.thread-manager.plist

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.bettermachine.thread-manager</string>
    
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/node</string>
        <string>/Users/woodhouse/.openclaw/workspace/projects/mesh-memory/thread-manager.mjs</string>
    </array>
    
    <key>WorkingDirectory</key>
    <string>/Users/woodhouse/.openclaw/workspace/projects/mesh-memory</string>
    
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>HOME</key>
        <string>/Users/woodhouse</string>
    </dict>
    
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    
    <key>StandardOutPath</key>
    <string>/tmp/thread-manager.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/thread-manager.error.log</string>
</dict>
</plist>
```

---

## 4. Network Configuration

### 4.1 /etc/hosts (All Nodes)

```
# Mesh-Memory Node Resolution
192.168.50.22  ray-node
192.168.50.23  liz-node
192.168.50.24  woodhouse-node
```

### 4.2 Firewall Rules (Ubuntu: Liz, Ray)

```bash
#!/bin/bash
# mesh-firewall.sh — Run on Linux nodes

# Allow mesh traffic from LAN subnet only
iptables -A INPUT -p tcp -s 192.168.50.0/24 --dport 18800 -j ACCEPT -m comment --comment "A2A Gateway"
iptables -A INPUT -p tcp -s 192.168.50.0/24 --dport 18801 -j ACCEPT -m comment --comment "A2A gRPC"
iptables -A INPUT -p tcp -s 192.168.50.0/24 --dport 18802 -j ACCEPT -m comment --comment "Thread Manager"
iptables -A INPUT -p tcp -s 192.168.50.0/24 --dport 18803 -j ACCEPT -m comment --comment "Mesh Receiver"

# Deny external access to mesh ports
iptables -A INPUT -p tcp --dport 18800 -j DROP
iptables -A INPUT -p tcp --dport 18801 -j DROP
iptables -A INPUT -p tcp --dport 18802 -j DROP
iptables -A INPUT -p tcp --dport 18803 -j DROP

# Save rules (Ubuntu)
iptables-save > /etc/iptables/rules.v4 2>/dev/null || iptables-save > /tmp/iptables-rules.v4
```

**UFW Alternative:**
```bash
ufw allow from 192.168.50.0/24 to any port 18800,18801,18802,18803 proto tcp
```

### 4.3 macOS Firewall (Woodhouse)

```bash
# Allow Node.js through firewall for mesh ports
/usr/libexec/ApplicationFirewall/socketfilterfw --add /opt/homebrew/bin/node

# Or use System Preferences > Security & Privacy > Firewall
# Add explicit allow rules for ports 18800-18803
```

### 4.4 Bind Address Verification

All services MUST bind to `0.0.0.0`, NOT `127.0.0.1` or `localhost`.

**Verification Command:**
```bash
ss -tlnp | grep -E '1880[0-3]'
```

**Correct Output:**
```
LISTEN 0 511 *:18800 *:* users:(("node",pid=...,fd=...))
LISTEN 0 511 *:18801 *:* users:(("node",pid=...,fd=...))
LISTEN 0 511 *:18802 *:* users:(("node",pid=...,fd=...))
LISTEN 0 511 *:18803 *:* users:(("node",pid=...,fd=...))
```

**Incorrect (localhost-bound):**
```
LISTEN 0 511 127.0.0.1:18803 *:*  # WRONG — not reachable from other nodes
```

---

## 5. Storage Strategy

### 5.1 Current Architecture

| Data Type | Storage | Location | Format |
|-----------|---------|----------|--------|
| Session events | SQLite | `~/.openclaw/lcm.db` | SQLite 3 |
| Mesh events | File-based | `~/.openclaw/workspace/memory/mesh/` | Markdown |
| Shared pool | File-based | `~/.openclaw/workspace/memory/shared/gates/` | JSON |
| Config | JSON | `~/.openclaw/workspace/projects/mesh-memory/mesh-memory.config.local.json` | JSON |

### 5.2 File-Based Storage (Retained)

**Advantages:**
- Human-readable (Markdown format)
- Git-trackable for backup/audit
- Simple to debug and inspect
- No database dependencies
- Append-only is naturally sequential

**Path Structure:**
```
~/.openclaw/workspace/memory/mesh/
├── 2026-04-12.md          # Daily event log
├── 2026-04-13.md
└── index.json             # Optional: QMD index
```

**Entry Format:**
```markdown
## [14:32:05] liz (assistant) [Erik Ross / user]
Received message from peer about mesh deployment.

> tags: `[mesh]` `[deployment]` `[infrastructure]`
```

### 5.3 SQLite for LCM (Retained)

The memory-bridge reads from `lcm.db` and exports to markdown. This separation:
- Keeps session data in its native format
- Allows mesh events to be append-only
- Prevents database contention between OpenClaw and mesh-memory

### 5.4 Storage Sizing Estimates

| Component | Daily Growth | Retention | Total Size |
|-----------|-------------|-----------|------------|
| Mesh events | ~50KB/day | 90 days | ~4.5MB |
| Shared pool | ~10KB/day | 30 days | ~300KB |
| LCM database | ~100KB/day | 365 days | ~36MB |

**Recommendation:** Current storage approach is optimal for this scale. No migration needed.

---

## 6. Health Monitoring System

### 6.1 Health Endpoint Contract

Each service implements:

```
GET /health
Authorization: Bearer <token>
```

**Response 200 OK:**
```json
{
  "status": "ok",
  "agentId": "liz",
  "service": "mesh-receiver",
  "version": "1.0.0",
  "timestamp": "2026-04-13T14:32:00Z",
  "uptime": 86400
}
```

**Response 401 Unauthorized:**
```json
{"error": "Unauthorized"}
```
*Note: 401 still proves the service is reachable; auth layer is functional.*

**Response 503 Service Unavailable:**
```json
{
  "status": "degraded",
  "reason": "task_queue_saturated"
}
```

### 6.2 Validation Levels

| Level | Endpoint | Expected | Proves |
|-------|----------|----------|--------|
| L1 | `GET /.well-known/agent.json` | HTTP 200 | A2A Gateway healthy |
| L2 | `GET /health` | HTTP 200/401 | Mesh Receiver reachable |
| L3 | `POST /` (with auth) | HTTP 200/201 | Full message flow works |

### 6.3 Validation Script

```bash
#!/bin/bash
# validate-mesh.sh — Run after deployment

set -e

PEERS=(
  "ray:192.168.50.22"
  "liz:192.168.50.23"
  "woodhouse:192.168.50.24"
)

TOKEN=$(jq -r '.receiverToken' ~/.openclaw/workspace/projects/mesh-memory/mesh-memory.config.local.json)
FAILED=0

echo "=== Mesh Health Validation ==="
echo "Timestamp: $(date -Iseconds)"
echo ""

for peer in "${PEERS[@]}"; do
  IFS=':' read -r name ip <<< "$peer"
  echo "--- Checking $name ($ip) ---"
  
  # L1: A2A Gateway
  if curl -sf --max-time 5 "http://$ip:18800/.well-known/agent.json" > /dev/null 2>&1; then
    echo "  L1 A2A (18800): ✓ OK"
  else
    echo "  L1 A2A (18800): ✗ FAIL"
    FAILED=1
  fi
  
  # L2: Mesh Receiver
  STATUS=$(curl -s --max-time 5 -w "%{http_code}" "http://$ip:18803/health" 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ] || [ "$STATUS" = "401" ]; then
    echo "  L2 Receiver (18803): ✓ OK (HTTP $STATUS)"
  else
    echo "  L2 Receiver (18803): ✗ FAIL (HTTP $STATUS)"
    FAILED=1
  fi
  
  # L3: Thread Manager (if applicable)
  TM_STATUS=$(curl -s --max-time 3 "http://$ip:18802/health" 2>/dev/null | jq -r '.status // "down"')
  if [ "$TM_STATUS" = "ok" ]; then
    echo "  L3 Thread Manager (18802): ✓ OK"
  else
    echo "  L3 Thread Manager (18802): ⚠ $TM_STATUS"
  fi
  
  echo ""
done

if [ $FAILED -eq 0 ]; then
  echo "✓✓✓ All critical services operational"
  exit 0
else
  echo "✗✗✗ Some services failed validation"
  exit 1
fi
```

### 6.4 Automated Health Checks (Cron)

```bash
# Add to crontab on Liz (primary)
*/5 * * * * /home/erik-ross/.openclaw/workspace/projects/mesh-memory/scripts/validate-mesh.sh > /tmp/mesh-health.log 2>&1 || echo "Mesh validation failed at $(date)" >> /tmp/mesh-alerts.log
```

### 6.5 Alerting Thresholds

| Metric | Warning | Critical | Action |
|--------|---------|----------|--------|
| L1 failure | — | 3 consecutive | Page operator |
| L2 failure | 1 failure | 3 consecutive | Restart service, alert |
| Response time > 2s | 2 occurrences | 5 consecutive | Investigate load |
| Disk space < 20% | Alert | — | Cleanup old logs |
| Memory usage > 80% | Alert | 95% | Restart service |

---

## 7. Security Considerations

### 7.1 Authentication

- **Bearer tokens:** 24-byte hex strings, stored in `mesh-memory.config.local.json`
- **Token distribution:** Via secure GitHub coordination repo (not committed to main)
- **Token rotation:** Manual — generate new, update all nodes, restart services

### 7.2 Network Security

- **LAN-only:** All mesh ports firewalled to 192.168.50.0/24
- **No external exposure:** Mesh receivers not reachable from internet
- **TLS:** Not implemented (LAN-only trust model)

### 7.3 Service Isolation

- **systemd:** `ProtectSystem=strict`, `NoNewPrivileges=true`
- **launchd:** Standard macOS sandbox
- **File permissions:** `~/.openclaw/workspace/memory/` restricted to user

### 7.4 Secrets Management (Future)

Consider migrating to:
- **systemd-creds:** For Linux nodes
- **macOS Keychain:** For Woodhouse
- **HashiCorp Vault:** If cluster grows beyond 3 nodes

---

## 8. Disaster Recovery

### 8.1 Backup Strategy

| Data | Frequency | Method | Location |
|------|-----------|--------|----------|
| mesh/*.md | Daily | Git commit | GitHub private repo |
| config.local.json | On change | Manual copy | 1Password/secure store |
| lcm.db | Daily | SQLite `.backup` | Local + rsync to Liz |

### 8.2 Recovery Procedures

**Single node failure:**
1. Reinstall mesh-memory from GitHub
2. Restore `mesh-memory.config.local.json`
3. Run setup.mjs to regenerate peer tokens if needed
4. Restart services

**Full mesh failure:**
1. Start with Liz (primary gateway)
2. Verify Liz operational before starting others
3. Start Ray, then Woodhouse
4. Run validation script after each node

---

## 9. References

- `A2A_RECEIVER_SPEC.md` — Peer verification protocol
- `CUSTOM_MESH_PROTOCOL_PLAN_2026-04-12.md` — Protocol migration plan
- `DEPLOY.md` — Deployment procedures
- `MESH_STATUS.md` — Current operational status
- AGENTS.md — Standing rules for receivers as managed services

---

*Document version: 1.0.0 — Generated by Liz Infrastructure Subagent*
