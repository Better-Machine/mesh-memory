# Mesh-Memory Deployment Guide

**Version:** 1.0.0  
**Date:** 2026-04-13  
**Audience:** DevOps engineers, agent operators  

---

## Quick Start

This guide provides step-by-step deployment instructions for converting mesh-memory from ad-hoc nohup processes to managed services (systemd on Linux, launchd on macOS).

**Pre-requisites:**
- mesh-memory v0.1.0+ already cloned and running (current state)
- OpenClaw A2A Gateway operational on all nodes
- Network connectivity between 192.168.50.22, 192.168.50.23, 192.168.50.24

**Deployment Order:**
1. Liz (192.168.50.23) — Reference implementation
2. Ray (192.168.50.22) — Validate Linux procedure
3. Woodhouse (192.168.50.24) — Validate macOS procedure

---

## Part 1: Liz (Ubuntu 25.10, Primary Gateway)

### Step 1: Pre-Deployment Verification

```bash
# Verify current state
ssh erik-ross@192.168.50.23

# Check existing processes
pgrep -a -f "memory-" | grep -v grep
# Expected: memory-receiver.mjs, memory-bridge.mjs, thread-manager.mjs

# Verify A2A health
curl -s http://localhost:18800/.well-known/agent.json | jq -r '.name'
# Expected: "Liz" or similar

# Verify receiver health
curl -s http://localhost:18803/health
# Expected: {"error":"Unauthorized"} (proves it's running)

# Check current bind addresses
ss -tlnp | grep -E '1880[0-3]'
# Expected: All ports bound to *: (0.0.0.0), NOT 127.0.0.1
```

### Step 2: Stop Existing Processes

```bash
cd ~/.openclaw/workspace/projects/mesh-memory

# Graceful shutdown
pkill -TERM -f memory-receiver.mjs
pkill -TERM -f memory-bridge.mjs
pkill -TERM -f thread-manager.mjs

# Wait and verify
sleep 3
pgrep -f "memory-" | grep -v grep
# Expected: No output (all processes stopped)

# Force kill if needed
pkill -9 -f memory-receiver.mjs 2>/dev/null || true
pkill -9 -f memory-bridge.mjs 2>/dev/null || true
pkill -9 -f thread-manager.mjs 2>/dev/null || true
```

### Step 3: Create Systemd User Directory

```bash
mkdir -p ~/.config/systemd/user
```

### Step 4: Create Service Files

**Create mesh-receiver.service:**

```bash
cat > ~/.config/systemd/user/mesh-receiver.service << 'EOF'
[Unit]
Description=Mesh-Memory Receiver — Inbound Memory Events
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/erik-ross/.openclaw/workspace/projects/mesh-memory
ExecStart=/usr/bin/node memory-receiver.mjs
ExecStartPre=/bin/sleep 2
Restart=always
RestartSec=10
StartLimitInterval=60
StartLimitBurst=3
MemoryMax=512M
CPUQuota=50%
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/home/erik-ross/.openclaw/workspace/memory
Environment="NODE_ENV=production"
Environment="HOME=/home/erik-ross"

[Install]
WantedBy=default.target
EOF
```

**Create mesh-bridge.service:**

```bash
cat > ~/.config/systemd/user/mesh-bridge.service << 'EOF'
[Unit]
Description=Mesh-Memory Bridge — LCM to Memory Export
After=network-online.target mesh-receiver.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/erik-ross/.openclaw/workspace/projects/mesh-memory
ExecStart=/usr/bin/node memory-bridge.mjs
Restart=always
RestartSec=30
MemoryMax=256M
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/home/erik-ross/.openclaw/workspace/memory
Environment="NODE_ENV=production"
Environment="HOME=/home/erik-ross"

[Install]
WantedBy=default.target
EOF
```

**Create thread-manager.service:**

```bash
cat > ~/.config/systemd/user/thread-manager.service << 'EOF'
[Unit]
Description=Mesh-Memory Thread Manager — Collaboration Engine
After=network-online.target mesh-receiver.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/erik-ross/.openclaw/workspace/projects/mesh-memory
ExecStart=/usr/bin/node thread-manager.mjs
Restart=always
RestartSec=10
MemoryMax=256M
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/home/erik-ross/.openclaw/workspace/memory
Environment="NODE_ENV=production"
Environment="HOME=/home/erik-ross"

[Install]
WantedBy=default.target
EOF
```

### Step 5: Enable and Start Services

```bash
# Reload systemd daemon
systemctl --user daemon-reload

# Enable services (start on boot/login)
systemctl --user enable mesh-receiver.service
systemctl --user enable mesh-bridge.service
systemctl --user enable thread-manager.service

# Start services
systemctl --user start mesh-receiver.service
systemctl --user start mesh-bridge.service
systemctl --user start thread-manager.service
```

### Step 6: Verify Services

```bash
# Check service status
systemctl --user status mesh-receiver.service
systemctl --user status mesh-bridge.service
systemctl --user status thread-manager.service

# All should show: "active (running)"

# Verify ports are bound
ss -tlnp | grep -E '1880[0-3]'

# Test health endpoints
curl -s http://localhost:18803/health
curl -s http://localhost:18802/health | jq
```

### Step 7: Configure Firewall

```bash
# Using UFW (recommended)
sudo ufw allow from 192.168.50.0/24 to any port 18800,18801,18802,18803 proto tcp

# Verify
sudo ufw status
```

**Or using iptables:**

```bash
sudo iptables -A INPUT -p tcp -s 192.168.50.0/24 --dport 18800 -j ACCEPT
sudo iptables -A INPUT -p tcp -s 192.168.50.0/24 --dport 18801 -j ACCEPT
sudo iptables -A INPUT -p tcp -s 192.168.50.0/24 --dport 18802 -j ACCEPT
sudo iptables -A INPUT -p tcp -s 192.168.50.0/24 --dport 18803 -j ACCEPT

# Save rules
sudo mkdir -p /etc/iptables
sudo iptables-save > /etc/iptables/rules.v4
```

### Step 8: Configure /etc/hosts

```bash
# Check current hosts
cat /etc/hosts

# Add mesh entries if missing
sudo tee -a /etc/hosts << 'EOF'
192.168.50.22  ray-node
192.168.50.23  liz-node
192.168.50.24  woodhouse-node
EOF
```

### Step 9: Liz Deployment Validation

```bash
# Run validation script
cd ~/.openclaw/workspace/projects/mesh-memory
./scripts/validate-mesh.sh

# Expected output:
# --- Checking liz (192.168.50.23) ---
#   L1 A2A (18800): ✓ OK
#   L2 Receiver (18803): ✓ OK (HTTP 401)
#   L3 Thread Manager (18802): ✓ OK
# ✓✓✓ All critical services operational
```

**Sign-off:** Liz deployment complete ✓

---

## Part 2: Ray (Ubuntu 25.10, UM880 Plus)

### Step 1: Pre-Deployment Verification

```bash
ssh erik-ross@192.168.50.22

# Check existing processes
pgrep -a -f "memory-"

# Verify A2A health
curl -s http://localhost:18800/.well-known/agent.json | jq -r '.name'
# Expected: "Ray"
```

### Step 2: Stop Existing Processes

```bash
cd ~/.openclaw/workspace/projects/mesh-memory

pkill -TERM -f memory-receiver.mjs
pkill -TERM -f memory-bridge.mjs
pkill -TERM -f thread-manager.mjs

sleep 3
pgrep -f "memory-" || echo "All processes stopped"
```

### Step 3: Create Systemd User Directory

```bash
mkdir -p ~/.config/systemd/user
```

### Step 4: Create Service Files

Copy the same three service files from Liz (Step 4), adjusting paths if different.

### Step 5: Enable and Start Services

```bash
systemctl --user daemon-reload
systemctl --user enable mesh-receiver.service mesh-bridge.service thread-manager.service
systemctl --user start mesh-receiver.service mesh-bridge.service thread-manager.service
```

### Step 6: Verify Services

```bash
systemctl --user status mesh-receiver.service
ss -tlnp | grep 18803
```

### Step 7: Configure Firewall

```bash
sudo ufw allow from 192.168.50.0/24 to any port 18800,18801,18802,18803 proto tcp
```

### Step 8: Configure /etc/hosts

```bash
sudo tee -a /etc/hosts << 'EOF'
192.168.50.22  ray-node
192.168.50.23  liz-node
192.168.50.24  woodhouse-node
EOF
```

### Step 9: Cross-Node Validation (From Liz)

On **Liz**, verify Ray is reachable:

```bash
# Test from Liz to Ray
curl -s --max-time 5 http://192.168.50.22:18800/.well-known/agent.json | jq -r '.name'
# Expected: "Ray"

# Test mesh receiver
STATUS=$(curl -s --max-time 5 -w "%{http_code}" http://192.168.50.22:18803/health -o /dev/null)
echo "Ray mesh receiver: HTTP $STATUS"
# Expected: HTTP 401 (or 200 if you include token)
```

**Sign-off:** Ray deployment complete ✓

---

## Part 3: Woodhouse (macOS, MacBook)

### Step 1: Pre-Deployment Verification

```bash
ssh woodhouse@192.168.50.24

# Check existing processes
pgrep -fl "memory-"

# Verify A2A health
curl -s http://localhost:18800/.well-known/agent.json | jq -r '.name'
# Expected: "Woodhouse"
```

### Step 2: Stop Existing Processes

```bash
cd ~/.openclaw/workspace/projects/mesh-memory

pkill -TERM -f memory-receiver.mjs
pkill -TERM -f memory-bridge.mjs
pkill -TERM -f thread-manager.mjs

sleep 3
pgrep -f "memory-" || echo "All processes stopped"
```

### Step 3: Create LaunchAgent Directory

```bash
mkdir -p ~/Library/LaunchAgents
```

### Step 4: Create Launchd Plist Files

**Create com.bettermachine.mesh-receiver.plist:**

```bash
cat > ~/Library/LaunchAgents/com.bettermachine.mesh-receiver.plist << 'EOF'
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
</dict>
</plist>
EOF
```

**Create com.bettermachine.mesh-bridge.plist:**

```bash
cat > ~/Library/LaunchAgents/com.bettermachine.mesh-bridge.plist << 'EOF'
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
EOF
```

**Create com.bettermachine.thread-manager.plist:**

```bash
cat > ~/Library/LaunchAgents/com.bettermachine.thread-manager.plist << 'EOF'
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
EOF
```

### Step 5: Load and Start Services

```bash
# Load the plist files
launchctl load ~/Library/LaunchAgents/com.bettermachine.mesh-receiver.plist
launchctl load ~/Library/LaunchAgents/com.bettermachine.mesh-bridge.plist
launchctl load ~/Library/LaunchAgents/com.bettermachine.thread-manager.plist

# Start services
launchctl start com.bettermachine.mesh-receiver
launchctl start com.bettermachine.mesh-bridge
launchctl start com.bettermachine.thread-manager

# Wait for startup
sleep 3
```

### Step 6: Verify Services

```bash
# List loaded services
launchctl list | grep bettermachine

# Check logs
tail /tmp/mesh-receiver.log
tail /tmp/mesh-receiver.error.log

# Verify ports
lsof -i :18803 | grep LISTEN
lsof -i :18802 | grep LISTEN

# Test health
curl -s http://localhost:18803/health
curl -s http://localhost:18802/health | jq
```

### Step 7: Configure macOS Firewall

```bash
# Allow Node.js through Application Firewall
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add /opt/homebrew/bin/node

# Or use System Preferences:
# System Preferences > Security & Privacy > Firewall > Options
# Add node executable and allow incoming connections on 18800-18803
```

### Step 8: Configure /etc/hosts

```bash
sudo tee -a /etc/hosts << 'EOF'
192.168.50.22  ray-node
192.168.50.23  liz-node
192.168.50.24  woodhouse-node
EOF
```

### Step 9: Cross-Node Validation (From Liz)

On **Liz**, verify Woodhouse is reachable:

```bash
# Test from Liz to Woodhouse
curl -s --max-time 5 http://192.168.50.24:18800/.well-known/agent.json | jq -r '.name'
# Expected: "Woodhouse"

# Test mesh receiver
STATUS=$(curl -s --max-time 5 -w "%{http_code}" http://192.168.50.24:18803/health -o /dev/null)
echo "Woodhouse mesh receiver: HTTP $STATUS"
# Expected: HTTP 401
```

**Sign-off:** Woodhouse deployment complete ✓

---

## Part 4: Full Mesh Validation

### Run Complete Validation Script

On **any node** (Liz recommended):

```bash
cd ~/.openclaw/workspace/projects/mesh-memory
./infrastructure/validate-mesh.sh
```

**Expected Output:**
```
=== Mesh Health Validation ===
Timestamp: 2026-04-13T14:32:00-04:00

--- Checking ray (192.168.50.22) ---
  L1 A2A (18800): ✓ OK
  L2 Receiver (18803): ✓ OK (HTTP 401)
  L3 Thread Manager (18802): ✓ OK

--- Checking liz (192.168.50.23) ---
  L1 A2A (18800): ✓ OK
  L2 Receiver (18803): ✓ OK (HTTP 401)
  L3 Thread Manager (18802): ✓ OK

--- Checking woodhouse (192.168.50.24) ---
  L1 A2A (18800): ✓ OK
  L2 Receiver (18803): ✓ OK (HTTP 401)
  L3 Thread Manager (18802): ✓ OK

✓✓✓ All critical services operational
```

### Manual Pairwise Testing

Test all 6 directed message paths:

```bash
# From Liz — test sending to Ray
TOKEN=$(jq -r '.peers[] | select(.agentId=="ray") | .receiverToken' ~/.openclaw/workspace/projects/mesh-memory/mesh-memory.config.local.json)
curl -X POST http://192.168.50.22:18803/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"liz","role":"test","content":"Test from Liz to Ray","timestamp":"'$(date -Iseconds)'"}'

# From Ray — test sending to Woodhouse
# From Woodhouse — test sending to Liz
# ... and all other combinations
```

---

## Part 5: Operations

### Daily Operations

**Check service status:**

```bash
# Linux
systemctl --user status mesh-receiver
systemctl --user status mesh-bridge
systemctl --user status thread-manager

# macOS
launchctl list | grep bettermachine
```

**View logs:**

```bash
# Linux (journald)
journalctl --user -u mesh-receiver -f

# macOS
tail -f /tmp/mesh-receiver.log
tail -f /tmp/mesh-receiver.error.log
```

**Restart services:**

```bash
# Linux
systemctl --user restart mesh-receiver

# macOS
launchctl stop com.bettermachine.mesh-receiver
launchctl start com.bettermachine.mesh-receiver
```

### Troubleshooting

**Service won't start:**
```bash
# Check for port conflicts
ss -tlnp | grep 18803
lsof -i :18803

# Check logs for errors
journalctl --user -u mesh-receiver --no-pager
```

**Connection refused from other nodes:**
- Verify firewall allows port 18803 from 192.168.50.0/24
- Verify service binds to 0.0.0.0 (not 127.0.0.1)
- Verify /etc/hosts entries

**401 Unauthorized on health check:**
- This is expected — means service is running
- Include bearer token for 200 OK

---

## Rollback Procedure

If deployment fails, revert to nohup:

```bash
# 1. Stop systemd/launchd services
# Linux:
systemctl --user stop mesh-receiver mesh-bridge thread-manager
systemctl --user disable mesh-receiver mesh-bridge thread-manager

# macOS:
launchctl stop com.bettermachine.mesh-receiver
launchctl unload ~/Library/LaunchAgents/com.bettermachine.mesh-receiver.plist
# ... repeat for bridge and thread-manager

# 2. Start with nohup
cd ~/.openclaw/workspace/projects/mesh-memory
nohup node memory-receiver.mjs > /dev/null 2>&1 &
nohup node memory-bridge.mjs > /dev/null 2>&1 &
nohup node thread-manager.mjs > /dev/null 2>&1 &

# 3. Verify
pgrep -f memory-receiver
```

---

## References

- `MESH_INFRASTRUCTURE_SPEC.md` — Full architecture specification
- `A2A_RECEIVER_SPEC.md` — Peer verification protocol
- AGENTS.md — Standing rules (receivers as managed services)

---

*Document version: 1.0.0 — Generated by Liz Infrastructure Subagent*
