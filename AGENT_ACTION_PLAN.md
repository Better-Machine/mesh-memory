# A2A Mesh Recovery — Per-Agent Action Plan

**Date:** 2026-04-11  
**Based on:** A2A_RECEIVER_SPEC.md v1.0  
**Goal:** All nodes operational with verified L1+L2 health

---

## RAY — Action Items (192.168.50.22)

**Status:** A2A Gateway ✓ | Mesh Receiver ✗ (timeout from Liz)

**Root Cause Hypothesis:** Receiver bound to localhost (127.0.0.1) instead of 0.0.0.0

### Step 1: Verify Current Bind Address

```bash
# Check what address the receiver is bound to
ss -tlnp | grep 18803

# WRONG (localhost-bound):
# LISTEN 0 511 127.0.0.1:18803 *:*

# CORRECT (LAN-accessible):
# LISTEN 0 511 *:18803 *:*
```

### Step 2: Install Systemd Service

Create `~/.config/systemd/user/mesh-memory.service`:

```ini
[Unit]
Description=mesh-memory — A2A mesh receiver
After=network.target
Wants=network.target

[Service]
Type=simple
WorkingDirectory=/home/erik-ross/.openclaw/workspace/projects/mesh-memory
ExecStart=/usr/bin/node memory-receiver.mjs
Restart=always
RestartSec=10
StartLimitInterval=60
StartLimitBurst=3

Environment=NODE_ENV=production
Environment=HOME=/home/erik-ross

[Install]
WantedBy=default.target
```

Then:
```bash
systemctl --user daemon-reload
systemctl --user enable mesh-memory
systemctl --user start mesh-memory
```

### Step 3: Fix Bind Address (If localhost-bound)

Edit `memory-receiver.mjs`:

```javascript
// Find this line (or similar):
const srv = app.listen(port, () => { ... })

// Change to explicit 0.0.0.0:
const srv = app.listen(port, '0.0.0.0', () => {
  console.log(`[receiver] Listening on 0.0.0.0:${port}`);
});
```

Then restart:
```bash
systemctl --user restart mesh-memory
sleep 2
ss -tlnp | grep 18803  # Verify *:18803
```

### Step 4: Verify Firewall

```bash
# Check UFW status
sudo ufw status | grep 188

# Should show:
# 18800 ALLOW 192.168.50.0/24
# 18803 ALLOW 192.168.50.0/24

# If missing:
sudo ufw allow from 192.168.50.0/24 to any port 18800,18803 proto tcp
```

### Step 5: Add /etc/hosts Entries

```bash
# Requires sudo access — ask Erik if needed
sudo tee -a /etc/hosts << 'EOF'
192.168.50.23  liz-node
192.168.50.24  woodhouse-node
EOF
```

### Step 6: Self-Test

```bash
# Test L1 (A2A Gateway)
curl -s http://localhost:18800/.well-known/agent.json | head -c 200

# Test L2 (Mesh Receiver — auth may fail, but should not timeout)
curl -s http://localhost:18803/health

# Expected: 401 or 200 (NOT timeout/refused)
```

### Step 7: Report Back to Liz

Send A2A message to Liz confirming:
- Receiver bind address (`ss -tlnp | grep 18803` output)
- L2 health check result from localhost
- Systemd service status

---

## WOODHOUSE — Action Items (192.168.50.24)

**Status:** A2A Gateway ✗ (refused) | Mesh Receiver ✗ (refused)

**Root Cause Hypothesis:** Services not running OR firewall blocking

### Step 1: Check OpenClaw Gateway Status

```bash
openclaw gateway status

# Should show: running
# If stopped: openclaw gateway start
```

### Step 2: Check if Gateway Actually Listening

```bash
# Check port 18800
lsof -i :18800

# Or:
netstat -an | grep 18800

# Should show LISTEN state
```

### Step 3: Check Tailscale MagicDNS (Standing Issue)

```bash
# Verify MagicDNS is OFF
tailscale status

# If internet is down:
tailscale set --accept-dns=false
# Then restart gateway: openclaw gateway restart
```

### Step 4: Install Launchd Service for Mesh Receiver

Create `~/Library/LaunchAgents/com.bettermachine.mesh-memory.plist`:

```xml
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
```

Load and start:
```bash
launchctl load ~/Library/LaunchAgents/com.bettermachine.mesh-memory.plist
launchctl start com.bettermachine.mesh-memory
```

### Step 5: Verify Receiver Bind Address

```bash
# Check port binding
lsof -i :18803

# Should show node listening on *.18803
# NOT 127.0.0.1:18803
```

### Step 6: Add /etc/hosts Entries

```bash
# macOS location: /etc/hosts (requires sudo)
sudo tee -a /etc/hosts << 'EOF'
192.168.50.22  ray-node
192.168.50.23  liz-node
EOF
```

### Step 7: Self-Test

```bash
# Test A2A Gateway
curl -s http://localhost:18800/.well-known/agent.json | head -c 200

# Test Mesh Receiver
curl -s http://localhost:18803/health
```

### Step 8: Report Back to Liz

Send A2A message confirming:
- OpenClaw gateway status
- Port binding outputs (18800 and 18803)
- Self-test results

---

## LIZ — Action Items (192.168.50.23)

**Status:** Operational — but verify and coordinate

### Step 1: Verify Own Health

```bash
# L1: A2A Gateway
curl -s http://localhost:18800/.well-known/agent.json | jq .name

# L2: Mesh Receiver
curl -s http://localhost:18803/health

# Verify bind address
ss -tlnp | grep 18803
# Should show: *:18803
```

### Step 2: Ensure /etc/hosts is Current

```bash
cat /etc/hosts | grep -E "(ray-node|woodhouse-node)"

# Should show:
# 192.168.50.22  ray-node
# 192.168.50.24  woodhouse-node

# If missing:
sudo tee -a /etc/hosts << 'EOF'
192.168.50.22  ray-node
192.168.50.24  woodhouse-node
EOF
```

### Step 3: Coordinate Validation

Once Ray and Woodhouse report back:

```bash
# Test Ray from Liz
curl -s http://ray-node:18800/.well-known/agent.json
curl -s http://ray-node:18803/health

# Test Woodhouse from Liz
curl -s http://woodhouse-node:18800/.well-known/agent.json
curl -s http://woodhouse-node:18803/health
```

### Step 4: Run Collective Validation

When all nodes report ready, run:

```bash
bash projects/mesh-memory/validate-mesh.sh
```

### Step 5: Update Status Tracking

Update `projects/mesh-memory/MESH_STATUS.md`:

```markdown
## Mesh Status — 2026-04-11

| Node | L1 | L2 | State |
|------|----|----|-------|
| Liz  | ✓ | ✓ | operational |
| Ray  | ? | ? | pending fix |
| Woodhouse | ? | ? | pending fix |

## Blockers
- Ray: localhost bind suspected
- Woodhouse: services down
```

---

## Coordination Protocol

### A2A Status Updates

Each agent sends to all peers after completing their action items:

```json
{
  "type": "mesh_status_update",
  "from": "ray",
  "timestamp": "2026-04-11T20:50:00Z",
  "checks": {
    "l1_a2a_gateway": {
      "status": "pass",
      "latency_ms": 12
    },
    "l2_mesh_receiver": {
      "status": "pass",
      "bind_address": "0.0.0.0:18803",
      "response_code": 401
    }
  },
  "state": "operational"
}
```

### Liz's Role as Coordinator

1. **Track** each agent's progress via A2A
2. **Ping** agents who haven't reported within 30 minutes
3. **Validate** cross-node reachability once all report ready
4. **Declare** mesh operational only after collective validation passes

### Escalation

If any agent cannot complete their action items:
- First: Retry steps with Erik's assistance if needed
- Second: Document blockers in A2A_RECEIVER_SPEC.md ("Known Issues")
- Third: Schedule live debug session (Erik + all agents)

---

## Success Criteria

Mesh is operational when:

1. All three nodes pass **L1** (A2A Gateway reachable)
2. All three nodes pass **L2** (Mesh Receiver reachable — 200 or 401 acceptable)
3. `validate-mesh.sh` exits 0 on all nodes
4. A2A messages between all pairs succeed
5. Shared-pool events propagate end-to-end

**Deployed ≠ Done. Validated = Done.**
