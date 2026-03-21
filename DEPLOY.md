# mesh-memory Deployment Guide

**Audience:** Humans and agents alike. Every step is explicit. Every assumption is named.  
**Authors:** Agent B (AI partner, Better Machine) · Erik Ross (Founder, Better Machine)

---

## Single agent or multi-agent?

mesh-memory works fully with a single agent. You get deep cross-session memory, privacy filtering, lesson tagging, and the dream cycle — no peers required.

Multi-agent features (collaboration threads, peer relay) are additive. Follow the **Single-Agent Install** section first. Add peers later when you're ready — or never, if you don't need them.

---

## Single-Agent Install

This is the complete install for one agent. No coordination with peers required.

### 1. Clone and install
```bash
git clone https://github.com/Better-Machine/mesh-memory
cd mesh-memory
npm install
```

### 2. Create your local config
```bash
cp mesh-memory.config.json mesh-memory.config.local.json
```
Edit `mesh-memory.config.local.json`:
- Set `agentId` to your agent name
- Set `receiverPort` to an available port (default 18803 — check with `ss -tlnp | grep 1880`)
- Generate a `receiverToken`: `node -e "const c=require('crypto');console.log(c.randomBytes(24).toString('hex'))"`
- Set `watchPaths` to your sessions directory (find it with `ls ~/.openclaw/agents/main/sessions/*.jsonl | head -1`)
- Leave `peers: []` — add peers later if needed

### 3. Start services
```bash
node memory-receiver.mjs &   # inbound relay listener
node memory-bridge.mjs &     # LCM → searchable memory export
node thread-manager.mjs &    # collaboration thread engine (port 18802)
```

### 4. Verify
```bash
curl http://localhost:18802/health
# Expected: {"status":"ok","agent":"<your-agent-id>","service":"thread-manager"}
```

That's it. Your agent now has persistent memory across sessions. Lesson tagging and privacy controls are active. The dream cycle will run nightly at 2 AM.

---

## Adding Peers (Multi-Agent)

When you're ready to connect peer agents, run setup.mjs to bootstrap token exchange:

```bash
node setup.mjs
```

This creates a private `mesh-memory-coordination` GitHub repo, publishes your token, and waits for peers to do the same. When all peers are ready, it writes `mesh-memory.config.local.json` automatically with full peer config.

**The golden rule for multi-agent:** install on all nodes before starting peer-to-peer features. Partial deployment causes relay failures that look like bugs but are timing gaps.

---

## Before You Start Multi-Agent: Read This

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
# From Agent B (.23), test Agent A (.22):
nc -zv 192.168.1.101 18801
# Expected before install: "Connection refused" (port not open yet — this is correct)
# Expected after install: "Connection succeeded"

# From Agent B (.23), test Agent C (.24):
nc -zv 192.168.1.103 18801
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
git clone https://github.com/Better-Machine/mesh-memory.git
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
- Agent B's machine: `"agent-b"`
- Agent A's machine: `"agent-a"`
- Agent C's machine: `"agent-c"`

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
sudo ufw allow from 192.168.1.0/24 to any port 18801
sudo ufw reload
```
Replace `192.168.1.0/24` with your actual LAN subnet if different.

**Do not expose port 18801 to the internet.** This service is LAN-only.

---

## Coordination Step: Run setup.mjs

**This step replaces all manual token exchange.** `setup.mjs` handles it automatically by creating a dedicated private GitHub repo (`mesh-memory-coordination`) that all agents use as their single source of truth.

### What setup.mjs does

1. Checks all prerequisites (Node, OpenClaw gateway, A2A, gh CLI)
2. Creates `mesh-memory-coordination` on GitHub if it doesn't exist — or joins the existing one
3. Generates this agent's receiver token
4. Publishes the token and receiver URL to the coordination repo
5. Polls until all peer tokens appear (with configurable timeout)
6. Writes `mesh-memory.config.local.json` automatically
7. Updates install status so peers know this agent is ready

### Running setup.mjs

```bash
node setup.mjs
```

The script is interactive and will guide you through each step. It prompts for:
- Agent ID (auto-suggested from hostname)
- Number of peers joining the mesh
- LAN IP (auto-detected, confirms before use)

### Timing: when to run setup.mjs on each node

Run setup.mjs on all nodes roughly simultaneously — or within a few minutes of each other. The script waits up to 5 minutes (configurable) for peer tokens to appear before timing out.

**Correct sequence:**
```
Node A: node setup.mjs     ← starts waiting for peers
Node B: node setup.mjs     ← starts waiting for peers  (within ~5 min of A)
Node C: node setup.mjs     ← starts waiting for peers  (within ~5 min of A)

All three publish tokens → all three detect each other → all three write config → done
```

**If a node times out waiting for peers:**
```bash
# Re-run setup — it will find the coordination repo already exists and
# join it, picking up any tokens that were published after the timeout
node setup.mjs --agent-id <your-id> --timeout 600
```

> **Timing conflict note for agents:** Seeing only your own token in the coordination repo is expected if peers haven't started setup.mjs yet. The script retries every 5 seconds. Do not interpret this as an error — just wait. If the timeout expires, re-run setup.mjs after confirming peers are ready.

### Granting repo access to peer agents

If peer agents are on different GitHub accounts, grant them access to the coordination repo:
```bash
gh repo edit <your-github-username>/mesh-memory-coordination --add-collaborator <peer-github-username>
```

For the Better Machine mesh (all repos under Better-Machine), no additional access is needed.

### Verifying setup completed on all nodes

Check the coordination repo's status directory:
```bash
ls ~/.openclaw/mesh-memory-coordination/status/
# Expected: one .json file per agent
# e.g.: agent-b.json  agent-a.json  agent-c.json

cat ~/.openclaw/mesh-memory-coordination/status/agent-a.json
# Expected: {"phase": "setup-complete", ...}
```

If any agent shows `"phase": "token-published"` instead of `"setup-complete"`, that agent's setup.mjs timed out or was interrupted. Have them re-run it.

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
[receiver] Agent: agent-b
[receiver] Ready for inbound events
```

**2. Verify receivers are up before starting watchers**

From each peer machine, confirm the receiver is reachable:
```bash
curl -s http://192.168.1.102:18801/health
# Expected: {"status":"ok","agentId":"agent-b","uptime":...}
```

Only proceed when all peers return healthy.

> **Why this order matters:** The watcher will start detecting messages immediately and the relay will try to deliver them. If a peer's receiver isn't up yet, the relay will log delivery failures. These are not permanent failures — the relay retries — but starting in the wrong order creates noisy logs that can mask real problems.

**3. Start watchers (all nodes)**
```bash
npm run watcher
```
Expected output:
```
[watcher] Agent: agent-b
[watcher] Watching: /home/your-user/.openclaw/agents/main/sessions
[watcher] Daemon started. Waiting for session writes...
```

**4. Start the bridge (all nodes)**
```bash
npm run bridge
```
Expected output:
```
[bridge] Agent: agent-b
[bridge] LCM database: /home/your-user/.openclaw/lcm.db
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
for ip in 192.168.1.101 192.168.1.102 192.168.1.103; do
  echo -n "$ip: "
  curl -sf http://$ip:18801/health | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['status'], d['agentId'])" 2>/dev/null || echo "UNREACHABLE"
done
```
Expected:
```
192.168.1.101: ok agent-a
192.168.1.102: ok agent-b
192.168.1.103: ok agent-c
```

### Test 2: Send a test event
```bash
# From Agent B, send a test event directly to Agent A's receiver:
curl -s -X POST http://192.168.1.101:18801/events \
  -H "Authorization: Bearer RAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "agent-b",
    "sessionKey": "test-session",
    "role": "assistant",
    "content": "mesh-memory integration test — if you can read this, the mesh is working",
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
  }'
```
Expected response: `{"status":"ok"}`

### Test 3: Verify it landed on the peer
```bash
# On Agent A's machine:
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
ssh your-user@192.168.1.101 "ps aux | grep memory-receiver"
```
If not running, start it. If the process is running but port is closed, check UFW:
```bash
ssh your-user@192.168.1.101 "sudo ufw status | grep 18801"
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
# Check Agent A's mesh memory for today:
ssh your-user@192.168.1.101 "cat ~/.openclaw/workspace/memory/mesh/$(date +%Y-%m-%d).md | tail -20"
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
0 2 * * * cd /home/your-user/.openclaw/workspace/projects/mesh-memory && node dream-cycle.mjs >> ~/.openclaw/logs/dream-cycle.log 2>&1
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
User=your-user
WorkingDirectory=/home/your-user/.openclaw/workspace/projects/mesh-memory
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
| Agent B | secondary | 192.168.1.102 | http://192.168.1.102:18801 | http://192.168.1.102:18800 |
| Agent A | primary | 192.168.1.101 | http://192.168.1.101:18801 | http://192.168.1.101:18800 |
| Agent C | mac | 192.168.1.103 | http://192.168.1.103:18801 | http://192.168.1.103:18800 |

> **Note for agents:** IPs are DHCP-assigned. If a machine's IP changes, update `mesh-memory.config.local.json` peers section and restart. Check current IPs in the your shared coordination notes or run `nmap -sn 192.168.1.0/24` to discover current assignments.

---

## Collaboration Threads (Layer 2)

The collaboration mesh runs on port **18802**, separate from the mesh-memory receiver (18801).

### Starting the thread manager

```bash
npm run threads
```

Or it starts automatically with `npm start` alongside the other services.

Expected output:
```
[thread-manager] Agent: agent-b
[thread-manager] Listening on port 18802
[thread-manager] Endpoints: /mesh/thread/propose, /mesh/thread/:id/write, /mesh/thread/:id/close
[thread-manager] Timeout checker running (1h interval)
```

### Firewall: open port 18802

```bash
sudo ufw allow from 192.168.1.0/24 to any port 18802
sudo ufw reload
```

### How thread proposals work

Threads are agent-initiated but can be triggered manually via HTTP for testing:

```bash
# Propose a thread (from this agent to peers)
curl -s -X POST http://localhost:18802/mesh/thread/propose \
  -H "Authorization: Bearer YOUR_RECEIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "threadId": "'$(python3 -c "import uuid; print(uuid.uuid4())")'",
    "proposingAgent": "agent-b",
    "purpose": "Coordinate clean-sl8 iOS deployment plan",
    "scope": "Deployment steps, timing, rollback plan",
    "participants": ["agent-b", "agent-a"],
    "closingCondition": "task complete",
    "timeoutHours": 4,
    "proposedAt": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
  }'
```

### User approval flow

After agents reach consensus, the user is notified via `openclaw system event`. The notification includes purpose, scope, participants, and closing condition.

To approve or decline, write to the response file:

```bash
# Approve
echo "YES" > memory/threads/pending/<threadId>/response.txt

# Decline
echo "NO" > memory/threads/pending/<threadId>/response.txt
```

The system polls this file every 10 seconds. If no response after 24 hours, the thread is auto-declined.

### Writing to an open thread

Once approved, participants write using ephemeral tokens (found in `memory/threads/<threadId>/tokens.json`):

```bash
curl -s -X POST http://localhost:18802/mesh/thread/<threadId>/write \
  -H "Authorization: Bearer YOUR_RECEIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "agent-b",
    "token": "EPHEMERAL_TOKEN_FROM_TOKENS_JSON",
    "role": "update",
    "content": "Deployment window confirmed: 2-4pm PST",
    "tags": ["decision"]
  }'
```

### How threads close

Threads close when:
- **Any participant** sends `POST /mesh/thread/<threadId>/close`
- **Timeout** — the thread manager checks every hour and closes threads past their `timeoutHours`

On close:
1. Manifest updated with `closedAt` and reason
2. All participants notified via HTTP
3. Ephemeral tokens deleted (invalidated)
4. Thread directory moved to `memory/threads/archive/<threadId>/`
5. If `threads.summarizeOnClose` is true in config, a summary.md is generated

### Thread files

```
memory/threads/<threadId>/
  manifest.json     — thread metadata
  context.md        — append-only shared context log
  tokens.json       — ephemeral per-participant tokens

memory/threads/archive/<threadId>/
  manifest.json     — includes closedAt + reason
  context.md        — final context
  summary.md        — optional summary (if summarizeOnClose enabled)
```

---

## Questions, Issues, Contributions

This is a live project in active development. If something doesn't work as documented, open an issue at https://github.com/Better-Machine/mesh-memory/issues.

For agents: if you discover a deployment failure mode not covered here, document it in this file and open a PR. This doc should get smarter over time.

---

*Built by Agent B and Erik Ross · Better Machine · 2026*
