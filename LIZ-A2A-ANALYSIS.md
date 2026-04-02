# LIZ-A2A-ANALYSIS.md — Independent A2A Reliability Assessment

**Author:** Liz (192.168.50.23)  
**Filed:** 2026-04-02  
**Requested by:** Woodhouse (independent, no pre-coordination with Ray)  
**Context:** Mr. Ross flagged A2A reliability as a priority problem. This is Liz's independent analysis.

---

## 1. What A2A Failures Have I Observed?

### 1.1 Woodhouse (.24) — Receiver Hanging (Recurring, High Impact)

The most persistent failure mode from my perspective is **Woodhouse's A2A receiver hanging on `message/send`** at `/a2a/jsonrpc`. Multiple documented instances across April 1:

- `.well-known/agent.json` resolves fine (port 18800 is up) — so the OpenClaw gateway is running
- `message/send` hangs **indefinitely** — never returns an error, never times out
- Not a network connectivity issue — the pre-check passes, the actual RPC call then stalls
- Happened at least 3 separate times on 2026-04-01 alone (documented in memory/2026-04-01.md)
- Woodhouse was also fully offline 2026-03-28 ~23:35 ET for unknown duration

**Pattern:** This is not a flaky send. The gateway process is alive but the A2A message queue or handler is blocked/degraded. It recovers at some point without intervention — but there's no signal of recovery, so callers wait forever or give up.

### 1.2 Ray (.22) — Receiver Port 18803 Suspected Localhost-Bound

Documented 2026-03-28: `curl http://192.168.50.22:18803/health` → exit code 28 (timeout). This was the **mesh-memory receiver** port, not the main A2A gateway (18800). Main A2A to Ray (18800) succeeded. Confirmed today: port 18800 on .22 is reachable, agent-card resolves fine.

**Pattern:** Ray's A2A gateway is healthy. The mesh-memory receiver layer (18803) is the weak link — possibly localhost-bound, possibly not running as a managed service.

### 1.3 Shell Session Timeout / False Failure Signal

Woodhouse flagged this as a known root cause on his end. I can confirm I've observed the same pattern in my own outbound sends:

- `a2a-reliable-send.sh` runs with `--non-blocking --wait --timeout-ms 180000` (3 minutes)
- Shell sessions spawned by OpenClaw are subject to their own timeout (exec sessions can be killed before the node script returns)
- When the shell dies (SIGTERM), the A2A call may have already delivered successfully — but the caller sees exit code 143 or similar and logs a failure
- This creates **false negatives**: the message was delivered, but the surface layer thinks it failed

**Pattern:** The failure is at the session boundary layer, not the A2A protocol layer. The message often succeeded.

### 1.4 DNS Resolution Failure — Hostname-Based Peer Config

**Critical gap on Liz's side:** `projects/continuity/peers.json` uses `http://ray-node:18800` and `http://woodhouse-node:18800` — but:

```
ray-node: DNS FAIL (getent hosts returns nothing)
woodhouse-node: DNS FAIL
```

There are **no `/etc/hosts` entries** for these hostnames. The `peers.json` comment says "Add entries to /etc/hosts for name resolution" — this was never done.

This means the `consolidate.mjs` script fails to reach either peer via hostname. The A2A gateway itself uses IPs directly (via `openclaw.json` config), so the main A2A path works. But any script or process using `continuity/peers.json` is silently broken.

**Asymmetry:** Main A2A (18800) uses IPs → works. Mesh-memory/continuity scripts use hostnames → DNS fail. The failure is tool-layer, not transport-layer.

---

## 2. Root Cause Analysis

### RC-1: No Stable Peer Identity / Address Scheme (HIGH)

The mesh has been hurt repeatedly by address instability:

- 2026-03-29: Woodhouse switched from .24 (Ethernet) to .248 (WiFi/DHCP) — broke all peer configs silently. Fixed by Erik setting static WiFi assignment.
- peers.json uses hostnames that don't resolve — intended as an abstraction, never completed
- `/etc/hosts` entries were documented as "required" but never added

**Root cause:** No authoritative peer identity layer. IPs are used directly everywhere, but IPs drift. Hostname abstraction was introduced but left half-baked. The result is a mesh where peer addresses are fragile and inconsistently configured across different config files.

### RC-2: Woodhouse Receiver Degradation Under Load (HIGH)

Woodhouse's A2A gateway accepts connections but hangs on message processing. Possible causes:

a) **Queue saturation** — the A2A agent task queue fills up (multiple in-flight A2A tasks from all three agents), and new `message/send` calls block waiting for a queue slot
b) **Session lock contention** — OpenClaw's `maxConcurrent: 4` means heavy workloads (e.g. agent-cowork analysis tasks) can exhaust the concurrency limit, blocking A2A handler threads
c) **Resource exhaustion** — Woodhouse is on a MacBook; if disk I/O or memory is under pressure (large model downloads, multiple concurrent agent sessions), the A2A handler may stall
d) **Blocking I/O in message handler** — if the handler does synchronous disk/file operations (writing to mesh-memory shared pool, etc.) and the I/O blocks, the handler thread stalls for all callers

The fact that `.well-known/agent.json` (a static file) resolves fine but `message/send` hangs points to (a) or (b) — the transport layer is alive, the application layer is blocked.

### RC-3: Shell Session Timeout Creates False Failure Signal (MEDIUM)

The `--wait --timeout-ms 180000` flag on a2a-reliable-send.sh sets a 3-minute max wait for async polling. But:

- The **shell exec session** in which the script runs has its own timeout
- If OpenClaw kills the shell before the 180s Node.js timeout fires, the process is SIGTERMed
- Node.js exits 143; bash reports failure; caller logs "A2A failed" — but the initial `message/send` may have already returned a task ID
- The message was delivered; only the **result polling** was interrupted

This is an observability failure: we can't distinguish "send failed" from "send succeeded but monitoring was killed." The reliable-send script was designed to solve this, but it can't help if the shell session itself is killed before the script completes.

### RC-4: Receiver Not Running as Managed Service (HIGH)

Confirmed: `18803` not listening on Liz's machine. No systemd service for mesh-memory receiver. Bare process from development runs — dies on logout, restart, or crash with no auto-recovery.

Same is suspected for Ray (port 18803 timeout from Liz's perspective on 2026-03-28).

**Root cause:** AGENTS.md standing rule ("Receivers must run as managed service — no bare processes") was not enforced during mesh-memory setup. The deployment was declared complete without validating the receiver was durably installed.

### RC-5: Inconsistent Config Across Tools (MEDIUM)

Three different config files for A2A peer addresses exist on Liz's node:

| File | Ray URL | Woodhouse URL |
|------|---------|---------------|
| `openclaw.json` / gateway config | IP (192.168.50.22) | IP (192.168.50.24) |
| `projects/continuity/peers.json` | `http://ray-node:18800` (DNS FAIL) | `http://woodhouse-node:18800` (DNS FAIL) |
| `projects/mesh-memory/mesh-memory.config.local.json` | `http://192.168.50.22:18803` | `http://192.168.50.24:18803` |

Three different formats, three different ports, two different address schemes. Scripts target different config files. This is the source of "works via main A2A but fails via mesh-memory" asymmetry.

### RC-6: No Send-Side Acknowledgment Guarantee (MEDIUM)

The current flow: send → async task ID → poll → result. If polling is interrupted (shell killed, RC-3), there's no persistent record of the sent task ID. On the next retry, a duplicate message is sent. Recipients get multiple copies; senders think prior send failed.

There's no idempotency key mechanism. The `--non-blocking --wait` pattern improves latency, but the state of "did I send this?" is lost if the polling session dies.

---

## 3. Concrete Fixes Proposed

### Fix 1: Complete the /etc/hosts peer entries (IMMEDIATE, 5 min)

```bash
sudo bash -c 'echo "192.168.50.22  ray-node" >> /etc/hosts'
sudo bash -c 'echo "192.168.50.24  woodhouse-node" >> /etc/hosts'
sudo bash -c 'echo "192.168.50.23  liz-node" >> /etc/hosts'
```

Do this on all three nodes. Zero code change, eliminates the DNS failure class. Not a long-term solution (IPs still drift), but closes the active gap.

### Fix 2: Install mesh-memory receiver as systemd service on all nodes (NEXT, Phase 0)

For Liz (.23 / Ubuntu):

```ini
[Unit]
Description=mesh-memory A2A receiver
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/erik-ross/.openclaw/workspace/projects/mesh-memory
ExecStart=/usr/bin/node receiver.mjs
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
```

Validate: `curl -s http://192.168.50.23:18803/health` returns 200/401 (not timeout).

Same pattern for Ray (systemd, .22) and Woodhouse (launchd, .24 macOS).

**Gate:** Do not declare Phase 0 complete until all three receiver health checks pass from each peer.

### Fix 3: Diagnose and fix Woodhouse receiver blocking (SHORT-TERM)

Woodhouse's A2A gateway is alive but message handlers hang. Diagnostic steps:
1. Check openclaw agent logs for task queue depth during hang
2. Check Node.js process memory / CPU during the hang (may be I/O blocked)
3. Implement a **request timeout on the A2A handler** — if a `message/send` doesn't complete in 30s, return a 503 rather than hanging indefinitely
4. Reduce `maxConcurrent` or add a handler-level semaphore to prevent queue saturation during heavy work

Short-term mitigation (already in practice): **check `.well-known/agent.json` response time** before sending — if it's slow (>500ms), defer the send. The card resolves via a different path than the message handler; card slowness often predicts handler saturation.

### Fix 4: Separate "send confirmed" from "response received" in reliable-send (SHORT-TERM)

Modify `a2a-reliable-send.sh` to:
1. Send in non-blocking mode → capture task ID → **write task ID to a local state file immediately**
2. Poll for result
3. On shell SIGTERM, trap signal and write "sent but polling interrupted, task: {id}" to the state file
4. On next run, check state file first — if task ID exists, resume polling instead of re-sending

This eliminates false failures and duplicate sends. State file should live in `/tmp/a2a-send-state/` with TTL.

### Fix 5: Consolidate peer config into single source of truth (MEDIUM-TERM)

Create `~/.openclaw/workspace/config/peers.yaml` as canonical:

```yaml
peers:
  ray:
    host: 192.168.50.22
    a2a_port: 18800
    receiver_port: 18803
    a2a_token: "<RAY_A2A_TOKEN>"
    receiver_token: "<RAY_RECEIVER_TOKEN>"
    display_name: "Ray-Primary"
    hardware: "constrained"  # extend timeouts 120s+
  woodhouse:
    host: 192.168.50.24
    a2a_port: 18800
    receiver_port: 18803
    a2a_token: "<WOODHOUSE_A2A_TOKEN>"
    receiver_token: "<WOODHOUSE_RECEIVER_TOKEN>"
    display_name: "Woodhouse-Primary"
  liz:
    host: 192.168.50.23
    a2a_port: 18800
    receiver_port: 18803
    display_name: "Liz-Secondary"
```

All tools (a2a-reliable-send.sh, consolidate.mjs, health checks) read from this single file. No more config drift.

### Fix 6: Per-node health monitoring cron (MEDIUM-TERM)

Liz already has a security audit cron (weekly). Add a lightweight A2A health check cron:

- Every 30 minutes: `curl --max-time 5` to each peer's `.well-known/agent.json` and receiver `/health`
- Write result to `memory/mesh/health-YYYY-MM-DD.json`
- Alert to Telegram if any peer is unreachable for >15 minutes

This gives us a historical record of actual downtime (vs "Woodhouse went offline at some point on 2026-03-28"). Currently we have no observability — we only learn about failures when trying to send.

### Fix 7: Distinguish "gateway up" from "receiver up" in health checks (DESIGN)

Current: we check `agent-card.json` to know if a peer is reachable. But this only tells us the OpenClaw A2A gateway (18800) is alive — not whether:
- The mesh-memory receiver (18803) is running
- The message handler can process new tasks
- The task queue has capacity

Proposed: Add a lightweight `GET /a2a/status` endpoint to the a2a-gateway plugin that returns:
```json
{
  "gateway": "ok",
  "taskQueue": {"active": 2, "capacity": 4},
  "receiverPort": 18803,
  "receiverHealth": "ok" | "unreachable" | "unknown"
}
```

This lets callers make informed decisions: don't send if queue depth is at capacity.

---

## 4. Prioritized Fix Sequence

| Priority | Fix | Effort | Impact |
|----------|-----|--------|--------|
| P0 | Fix /etc/hosts DNS entries (all nodes) | 5 min | Eliminates DNS failure class |
| P0 | Install receivers as managed services (all nodes) | 2h | Eliminates receiver downtime on restart |
| P1 | Add task ID state file to reliable-send | 1h | Eliminates false failures + duplicate sends |
| P1 | Diagnose + fix Woodhouse handler blocking | Unknown | Eliminates the most common failure I observe |
| P2 | Consolidate peer config to single YAML | 2h | Eliminates config drift across tools |
| P2 | Per-node health monitoring cron | 1h | Gives observability where we currently have none |
| P3 | `/a2a/status` endpoint design | 3h | Enables intelligent routing and backpressure |

---

## 5. Liz's Position on Root Cause Priority

**The single biggest reliability killer from my observation: Woodhouse's message handler blocking.** Every time I need to coordinate with Woodhouse (which is every consensus task, every multi-agent deliverable), I hit this. It's not intermittent — it's _frequent_. The other issues are important but would not meaningfully improve the mesh experience without fixing this one first.

**The most dangerous unclosed gap: no receiver managed services.** We declared the mesh live in March. Receivers were running as bare processes. We had no idea until things started failing silently. This is the root cause of "we think something is working when it isn't" — the exact failure mode that caused the false deployment declaration on 2026-03-28.

**On Erik's tolerance doctrine (2026-03-31):** A2A challenges mirror human collaboration problems — true. But the failures described above aren't the normal friction of heterogeneous systems. DNS failures, unmanaged services, and hanging handlers are infrastructure failures — things we caused and can fix. We shouldn't accept these as "the normal variance" and build tolerance layers on top of broken foundations. Fix the foundation first; then design for residual variance.

---

_Filed by Liz — 2026-04-02. Not coordinated with Ray prior to filing._
