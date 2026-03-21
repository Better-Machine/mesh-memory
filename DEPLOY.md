# mesh-memory Deployment Guide

**Audience:** Humans and agents alike. Every step is explicit. Every assumption is named.  
**Authors:** Liz (AI partner, Better Machine) · Erik Ross (Founder, Better Machine)

---

## Before You Start: Read This Entirely First

Mesh-memory involves coordinated installation across multiple agents on multiple machines. The single most common failure mode is **partial deployment** — one agent installed and running while peers are not yet ready, causing relay failures that look like bugs but are actually timing gaps.

**The golden rule: install on all nodes before starting any of them.**

---

## Prerequisites Checklist

Complete this on every machine before touching mesh-memory.

### 1. Verify OpenClaw is running
```bash
openclaw gateway status
```
Expected: `running` with a pid. If not running, start it:
```bash
openclaw gateway start
```

### 2. Verify A2A is installed and responding
```bash
curl -s http://localhost:18800/.well-known/agent-card.json | head -5
```
Expected: JSON with `"name"` and `"url"` fields. If this fails, the A2A plugin is not running — do not proceed. Fix A2A first.

> **Why this matters:** mesh-memory uses A2A for cross-agent transport. If A2A is down on any node, that node will silently drop all inbound relayed messages. The watcher and relay will appear to work; the receiver will not.

### 3. Verify Node.js version
```bash
node --version
```
Expected: `v18.0.0` or higher. mesh-memory uses ES modules (`import`/`export`) and requires Node 18+.

### 4. Verify network reachability between agents
From each machine, ping every peer's port 18801:
```bash
# From Liz (.23), test Ray (.22):
nc -zv 192.168.50.22 18801
# Expected before install: "Connection refused" (port not open yet — this is correct)
# Expected after install: "Connection succeeded"

# From Liz (.23), test Woodhouse (.24):
nc -zv 192.168.50.24 18801
```

> **Note for agents:** "Connection refused" before install is expected and correct. The receiver process that opens port 18801 doesn't exist yet. Do not interpret this as a firewall problem during pre-install checks.

### 5. Verify LCM database path (for the bridge component)
```bash
ls ~/.openclaw/lcm.db 2>/dev/null && echo "LCM db found" || echo "LCM db not found — bridge will wait"
```
If not found, the bridge component will start in a waiting state and activate once LCM creates the database. This is not an error.

---

## Installation: Do This on Every Node

### Step 1: Clone the repo
```bash
cd ~/.openclaw/workspace/projects
git clone https://github.com/Kosfootel/mesh-memory.git
cd mesh-memory
```

### Step 2: Install dependencies
```bash
npm install
```
Expected: installs `express`, `better-sqlite3`, `chokidar`, `concurrently`. Should take 15-30 seconds.

If `better-sqlite3` fails to build:
```bash
npm install --ignore-scripts
npm rebuild better-sqlite3
```

### Step 3: Generate a receiver token for this node
Each node needs its own unique bearer token. Generate one:
```bash
node -e "const c=require('crypto');console.log(c.randomBytes(24).toString('hex'));"
```
Copy this value. You will share it with all peer agents so they can authenticate when sending you events. **Keep it — you'll need it in Step 4 and again when configuring peers.**

### Step 4: Configure this node
Copy the example config:
```bash
cp mesh-memory.config.json mesh-memory.config.local.json
```

> **Important:** Use `mesh-memory.config.local.json` for your real config. This file is gitignored and will never be committed. Never put real tokens in `mesh-memory.config.json`.

Edit `mesh-memory.config.local.json`:
```json
{
  "agentId": "YOUR_AGENT_ID",
  "receiverPort": 18801,
  "receiverToken": "YOUR_TOKEN_FROM_STEP_3",
  "peers": [],
  "watchPaths": [
    "~/.openclaw/agents/main/sessions"
  ],
  "bridgeInterval": 60,
  "relayRateLimit": 1000,
  "filter": {
    "minContentLength": 20,
    "skipRoles": ["tool", "system"]
  }
}
```

Leave `peers` empty for now. You will add peers in the coordination step.

Set `agentId` to a short, lowercase identifier:
- Liz's machine: `"liz"`
- Ray's machine: `"ray"`
- Woodhouse's machine: `"woodhouse"`

### Step 5: Confirm session JSONL path exists
```bash
ls ~/.openclaw/agents/main/sessions/ 2>/dev/null | head -5
```
Expected: one or more `.jsonl` files. If the directory doesn't exist yet (fresh install with no sessions yet):
```bash
mkdir -p ~/.openclaw/agents/main/sessions
```
The watcher will activate when session files appear.

### Step 6: Open the firewall for port 18801
```bash
sudo ufw allow from 192.168.50.0/24 to any port 18801
sudo ufw reload
```
Replace `192.168.50.0/24` with your actual LAN subnet if different.

**Do not expose port 18801 to the internet.** This service is LAN-only.

---

## Coordination Step: Exchange Tokens Between Agents

This step requires all nodes to be at the same point in the install process. **Do not start any services until token exchange is complete on all nodes.**

### How to exchange tokens

Each agent shares their `receiverToken` with all peers. In the Better Machine mesh:

1. Liz posts her token to the agentcy-services repo handoffs directory
2. Ray posts his token
3. Woodhouse posts his token
4. Each agent reads the others' tokens and updates their config

#### Liz — post your token:
```bash
cat >> /home/erik-ross/.openclaw/workspace/projects/agentcy-services/handoffs/mesh-memory-tokens.md << EOF

## Liz token ($(date +%Y-%m-%d))
Receiver URL: http://192.168.50.23:18801
Token: YOUR_LIZ_TOKEN_HERE
EOF
git -C /home/erik-ross/.openclaw/workspace/projects/agentcy-services add -A
git -C /home/erik-ross/.openclaw/workspace/projects/agentcy-services commit -m "mesh-memory: liz receiver token"
git -C /home/erik-ross/.openclaw/workspace/projects/agentcy-services push
```

#### Wait for all peers to post their tokens
```bash
# Pull and check
git -C /home/erik-ross/.openclaw/workspace/projects/agentcy-services pull
cat /home/erik-ross/.openclaw/workspace/projects/agentcy-services/handoffs/mesh-memory-tokens.md
```

Do not proceed until you see tokens from all peers in this file.

> **Timing conflict note for agents:** If you pull this file and see only your own token, it means peers have not yet completed their install. Wait and retry in 2-3 minutes. Do not start services. Do not assume peers are broken — they may simply be mid-install.

### Update your config with peer tokens

Once all tokens are available, update `mesh-memory.config.local.json` peers section:
```json
"peers": [
  {
    "name": "ray",
    "url": "http://192.168.50.22:18801",
    "token": "RAY_TOKEN_FROM_HANDOFF_FILE"
  },
  {
    "name": "woodhouse",
    "url": "http://192.168.50.24:18801",
    "token": "WOODHOUSE_TOKEN_FROM_HANDOFF_FILE"
  }
]
```

Adjust URLs to match the actual IP of each peer. Use the IPs in the tokens file, not assumed IPs.

---

## Starting Services

### Start order matters

Start in this order to minimise relay errors during the startup window:

**1. Start receivers first (all nodes, simultaneously if possible)**
```bash
npm run receiver
```
Expected output:
```
[receiver] Listening on port 18801
[receiver] Agent: liz
[receiver] Ready for inbound events
```

**2. Verify receivers are up before starting watchers**

From each peer machine, confirm the receiver is reachable:
```bash
curl -s http://192.168.50.23:18801/health
# Expected: {"status":"ok","agentId":"liz","uptime":...}
```

Only proceed when all peers return healthy.

> **Why this order matters:** The watcher will start detecting messages immediately and the relay will try to deliver them. If a peer's receiver isn't up yet, the relay will log delivery failures. These are not permanent failures — the relay retries — but starting in the wrong order creates noisy logs that can mask real problems.

**3. Start watchers (all nodes)**
```bash
npm run watcher
```
Expected output:
```
[watcher] Agent: liz
[watcher] Watching: /home/erik-ross/.openclaw/agents/main/sessions
[watcher] Daemon started. Waiting for session writes...
```

**4. Start the bridge (all nodes)**
```bash
npm run bridge
```
Expected output:
```
[bridge] Agent: liz
[bridge] LCM database: /home/erik-ross/.openclaw/lcm.db
[bridge] Polling every 60 seconds
[bridge] Last cursor: none (first run)
```

**5. Start everything together for production**

Once you've validated each component, use the combined start:
```bash
npm start
```

This runs watcher + receiver + bridge via `concurrently`.

---

## Verify the Mesh is Working

### Test 1: Health check all receivers
```bash
for ip in 192.168.50.22 192.168.50.23 192.168.50.24; do
  echo -n "$ip: "
  curl -sf http://$ip:18801/health | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['status'], d['agentId'])" 2>/dev/null || echo "UNREACHABLE"
done
```
Expected:
```
192.168.50.22: ok ray
192.168.50.23: ok liz
192.168.50.24: ok woodhouse
```

### Test 2: Send a test event
```bash
# From Liz, send a test event directly to Ray's receiver:
curl -s -X POST http://192.168.50.22:18801/events \
  -H "Authorization: Bearer RAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "liz",
    "sessionKey": "test-session",
    "role": "assistant",
    "content": "mesh-memory integration test — if you can read this, the mesh is working",
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
  }'
```
Expected response: `{"status":"ok"}`

### Test 3: Verify it landed on the peer
```bash
# On Ray's machine:
cat ~/.openclaw/workspace/memory/mesh/$(date +%Y-%m-%d).md
```
Expected: the test message content appears.

### Test 4: End-to-end latency
Send a real message in your OpenClaw session, then check peers within 60 seconds:
```bash
# On a peer machine, watch for new entries:
watch -n 5 "tail -5 ~/.openclaw/workspace/memory/mesh/$(date +%Y-%m-%d).md 2>/dev/null"
```

---

## Known Failure Modes and How to Handle Them

### "Connection refused" on port 18801
The receiver is not running on that peer. Check if the process is alive:
```bash
ssh erik-ross@192.168.50.22 "ps aux | grep memory-receiver"
```
If not running, start it. If the process is running but port is closed, check UFW:
```bash
ssh erik-ross@192.168.50.22 "sudo ufw status | grep 18801"
```

### "Unauthorized" from receiver
Token mismatch. The token in your `peers` config does not match the target agent's `receiverToken`. Re-check the handoff file and update your config. Then restart the watcher.

### Watcher detects messages but relay shows all failures
All peers are unreachable simultaneously. Check:
1. Are receiver processes running on all peers?
2. Did receiver ports open after a reboot? (Services need to be restarted after reboot unless set up as system services — see Persistence section below)
3. Did IP addresses change? (Check `/etc/hosts` or router DHCP leases)

### Messages appear delayed beyond 60 seconds
QMD indexing interval may be set higher than default. Check:
```bash
openclaw config get memory.qmd.update.interval
```
If it returns more than `5m`, lower it:
```bash
openclaw config set memory.qmd.update.interval "1m"
openclaw gateway restart
```

### Bridge logs "table not found" errors
LCM database schema may differ from what the bridge expects. The bridge auto-discovers table names, but if LCM schema changes between OpenClaw versions, update the query in `memory-bridge.mjs`. Check actual schema:
```bash
sqlite3 ~/.openclaw/lcm.db ".schema"
```

### Agents have inconsistent mesh state (some see messages others don't)
This is the A2A state consistency problem. Mesh-memory is eventually consistent, not strongly consistent. Each agent's view of the mesh lags by up to 60 seconds. **This is by design.** If you need to verify what a peer currently knows:
```bash
# Check Ray's mesh memory for today:
ssh erik-ross@192.168.50.22 "cat ~/.openclaw/workspace/memory/mesh/$(date +%Y-%m-%d).md | tail -20"
```

To force a fresh relay of recent context from any agent, trigger a compact:
```
/compact
```
This forces LCM to summarize, which the bridge will pick up on the next poll.

---

## Setting Up the Dream Cycle

The dream cycle runs nightly to consolidate mesh memory into MEMORY.md suggestions.

```bash
crontab -e
```

Add this line (runs at 2:00 AM local time):
```
0 2 * * * cd /home/erik-ross/.openclaw/workspace/projects/mesh-memory && node dream-cycle.mjs >> ~/.openclaw/logs/dream-cycle.log 2>&1
```

The dream cycle writes suggestions to:
```
~/.openclaw/workspace/memory/dream-cycle-YYYY-MM-DD.md
```

**It does not auto-modify MEMORY.md.** Erik reviews and approves any changes before they're merged. This is intentional — automated memory writes without human review create drift.

---

## Running the Stress Test

The stress test validates system performance before full deployment.

```bash
node stress-test.mjs
```

This runs approximately 10-15 minutes and produces `stress-test-report.md`.

**Pass criteria:**
- p95 end-to-end latency < 5 seconds (within-agent)
- p95 cross-agent latency < 60 seconds
- Message loss rate < 1%
- CPU overhead at sustained 10 msg/min < 5%
- No crashes or unhandled exceptions

**If the stress test fails:** Do not deploy to production. Review `stress-test-report.md` and address the failures. Common issues: rate limiter too aggressive (increase `relayRateLimit`), receiver timeout too low, or disk write bottleneck on the mesh markdown files.

---

## Persistence: Running as a Service

For production, run mesh-memory as a systemd service so it survives reboots.

### Create the service file
```bash
sudo tee /etc/systemd/system/mesh-memory.service > /dev/null << EOF
[Unit]
Description=mesh-memory — per-message cross-agent memory mesh
After=network.target

[Service]
Type=simple
User=erik-ross
WorkingDirectory=/home/erik-ross/.openclaw/workspace/projects/mesh-memory
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
```

### Enable and start
```bash
sudo systemctl daemon-reload
sudo systemctl enable mesh-memory
sudo systemctl start mesh-memory
```

### Check status
```bash
sudo systemctl status mesh-memory
journalctl -u mesh-memory -f
```

---

## For Agents: State Awareness Protocol

When mesh-memory is running, you have access to peer context via `memory_search`. But you need to reason correctly about what you do and don't know.

**What you can trust:**
- `memory/mesh/YYYY-MM-DD.md` — peer messages from the last 24h, up to ~60s lag
- `memory/lcm/*.md` — LCM summaries from all sessions on this machine, up to ~60s lag
- Your own `MEMORY.md` and `memory/YYYY-MM-DD.md` — always current

**What you cannot assume:**
- That peers have received your latest messages yet (up to 60s lag)
- That your mesh memory is complete (peers may have been offline, restarting, or mid-install)
- That LCM bridge has caught up (bridge polls every 60s; a recent compact may not be indexed yet)

**When operating in coordinated tasks with peers:**
- Always check `memory/mesh/` before assuming a peer has no context on a topic
- If you need to verify peer state, send an explicit A2A message asking for confirmation
- Do not re-explain context that appears in mesh memory — treat it as shared
- If mesh memory for today is empty or very thin, assume the mesh restarted recently and re-establish context explicitly

**Startup sequence for agents (each session):**
1. `memory_search` for today's mesh entries — how fresh is peer context?
2. `memory_search` for recent LCM summaries — what did I cover in prior sessions?
3. If mesh entries are > 2 hours stale: note this and operate conservatively on peer state assumptions

---

## Updating mesh-memory

```bash
cd ~/.openclaw/workspace/projects/mesh-memory
git pull origin main
npm install
sudo systemctl restart mesh-memory
```

After updating, re-run the health check and Test 2 (test event) to confirm the update didn't break the mesh.

---

## Reference: Network Map (Better Machine Mesh)

| Agent | Machine | IP | Receiver URL | A2A URL |
|---|---|---|---|---|
| Liz | secondary | 192.168.50.23 | http://192.168.50.23:18801 | http://192.168.50.23:18800 |
| Ray | primary | 192.168.50.22 | http://192.168.50.22:18801 | http://192.168.50.22:18800 |
| Woodhouse | mac | 192.168.50.24 | http://192.168.50.24:18801 | http://192.168.50.24:18800 |

> **Note for agents:** IPs are DHCP-assigned. If a machine's IP changes, update `mesh-memory.config.local.json` peers section and restart. Check current IPs in the agentcy-services repo COORDINATION.md or run `nmap -sn 192.168.50.0/24` to discover current assignments.

---

## Questions, Issues, Contributions

This is a live project in active development. If something doesn't work as documented, open an issue at https://github.com/Kosfootel/mesh-memory/issues.

For agents: if you discover a deployment failure mode not covered here, document it in this file and open a PR. This doc should get smarter over time.

---

*Built by Liz and Erik Ross · Better Machine · 2026*
