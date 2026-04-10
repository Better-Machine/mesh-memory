# OpenClaw Compatibility Check

**Purpose:** Verify mesh-memory compatibility after OpenClaw version updates.

**When to run:**
- After every `openclaw update`
- After any OpenClaw gateway restart
- When mesh-memory processes fail to start or behave unexpectedly

---

## Quick Check (30 seconds)

```bash
cd ~/.openclaw/workspace/projects/mesh-memory
npm run compatibility-check 2>/dev/null || node -e "
const http = require('http');
const config = require('./mesh-memory.config.local.json');
const req = http.request({
  hostname: 'localhost',
  port: config.receiverPort || 18803,
  path: '/health',
  headers: { 'Authorization': 'Bearer ' + config.receiverToken },
  timeout: 5000
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log(data.includes('ok') ? '✅ Mesh-memory healthy' : '❌ Health check failed');
  });
});
req.on('error', () => console.log('❌ Cannot connect to mesh-memory'));
req.end();
"
```

---

## Full Compatibility Checklist

### 1. OpenClaw Version Verification

```bash
openclaw --version
git -C ~/.npm-global/lib/node_modules/openclaw log --oneline -3
```

**Record:**
- OpenClaw version: ___________
- Last update date: ___________
- Previous version: ___________

---

### 2. Gateway Status

```bash
openclaw gateway status
```

**Verify:**
- [ ] Gateway is running
- [ ] No config validation errors
- [ ] No port conflicts
- [ ] LCM plugin loaded

**Known breaking changes:**
| OpenClaw Version | Breaking Change | Mesh-Memory Impact |
|------------------|-----------------|-------------------|
| 2026.4.x | Config format changes | May require config updates |
| 2026.3.x | Plugin loading order | May affect initialization timing |
| TBD | LCM schema changes | May break bridge export |

---

### 3. LCM Database Access

```bash
ls -la ~/.openclaw/lcm.db
sqlite3 ~/.openclaw/lcm.db ".tables" 2>/dev/null | grep -E "summaries|lcm" && echo "✅ LCM accessible" || echo "❌ LCM not accessible"
```

**Verify:**
- [ ] `~/.openclaw/lcm.db` exists
- [ ] Database is readable
- [ ] Contains expected tables (summaries, summary, lcm_summaries, or entries)

**If LCM schema changed:**
Check `memory-bridge.mjs` — it auto-detects schema but may need updates for new tables.

---

### 4. Mesh-Memory Component Status

```bash
ps aux | grep -E "mesh-memory|receiver.js|bridge.js|watcher.js" | grep -v grep
```

**Expected processes:**
- [ ] `mesh-memory.mjs receiver` — HTTP receiver endpoint
- [ ] `mesh-memory.mjs bridge` — LCM database bridge
- [ ] `mesh-memory.mjs watcher` — Session file watcher

**If processes are missing:**
```bash
cd ~/.openclaw/workspace/projects/mesh-memory
npm start
# or individually:
nohup node mesh-memory.mjs receiver > receiver.log 2>&1 &
nohup node mesh-memory.mjs bridge > bridge.log 2>&1 &
nohup node mesh-memory.mjs watcher > watcher.log 2>&1 &
```

---

### 5. Port Binding Verification

```bash
ss -tlnp 2>/dev/null | grep 18803 || netstat -tlnp 2>/dev/null | grep 18803
curl -s http://localhost:18803/health -H "Authorization: Bearer $(cat ~/.openclaw/workspace/projects/mesh-memory/mesh-memory.config.local.json | grep receiverToken | sed 's/.*: "\(.*\)".*/\1/')" | jq .
```

**Verify:**
- [ ] Port 18803 is listening
- [ ] Health endpoint returns `{"status":"ok"}`
- [ ] Not bound to localhost only (should be `0.0.0.0:18803` or `:::18803`)

**If bound to 127.0.0.1 only:**
Check config — `receiverBind` should be `"0.0.0.0"` for LAN access.

---

### 6. Config File Validation

```bash
cd ~/.openclaw/workspace/projects/mesh-memory
node -e "const c = require('./mesh-memory.config.local.json'); console.log('✅ Config valid'); console.log('Agent:', c.agentId); console.log('Port:', c.receiverPort); console.log('Peers:', c.peers?.length || 0);"
```

**Verify:**
- [ ] `mesh-memory.config.local.json` exists
- [ ] JSON is valid
- [ ] `agentId` is set
- [ ] `receiverToken` is set
- [ ] `receiverPort` is set (default: 18803)
- [ ] `peers` array exists (can be empty)

---

### 7. File Paths & Permissions

```bash
ls -la ~/.openclaw/workspace/memory/mesh/ 2>/dev/null | head -5
ls -la ~/.openclaw/workspace/memory/lcm/ 2>/dev/null | head -5
ls -la ~/.openclaw/agents/main/sessions/ 2>/dev/null | head -3
```

**Verify:**
- [ ] `memory/mesh/` exists and is writable
- [ ] `memory/lcm/` exists and is writable
- [ ] `agents/main/sessions/` exists (watcher path)

---

### 8. Cron Jobs (Dream Cycle)

```bash
crontab -l 2>/dev/null | grep mesh-memory
crontab -l 2>/dev/null | grep dream
```

**Expected:**
```
0 2 * * * cd ~/.openclaw/workspace/projects/mesh-memory && node dream-cycle.mjs >> dream-cycle.log 2>&1
```

**Verify:**
- [ ] Dream cycle cron job exists
- [ ] Path is correct
- [ ] Log file is writable

---

### 9. Multi-Agent Peer Connectivity (if configured)

```bash
cd ~/.openclaw/workspace/projects/mesh-memory
for peer in $(cat mesh-memory.config.local.json | jq -r '.peers[]?.receiverUrl' 2>/dev/null); do
  echo "Testing $peer..."
  curl -s --connect-timeout 3 "$peer/health" -H "Authorization: Bearer $(cat mesh-memory.config.local.json | jq -r '.peers[] | select(.receiverUrl == \"'$peer'\") | .receiverToken')" 2>/dev/null && echo " ✅" || echo " ❌ unreachable"
done
```

**Verify:**
- [ ] All configured peers are reachable
- [ ] Health endpoints return OK
- [ ] No firewall blocks between nodes

---

### 10. Log Analysis

```bash
cd ~/.openclaw/workspace/projects/mesh-memory
echo "=== Recent Errors ===" && tail -50 receiver.log 2>/dev/null | grep -i "error\|fail\|exception" | tail -10
echo "=== Bridge Status ===" && tail -20 bridge.log 2>/dev/null | tail -5
echo "=== Watcher Status ===" && tail -20 watcher.log 2>/dev/null | tail -5
```

**Check for:**
- [ ] No recent errors
- [ ] No connection refused errors
- [ ] No config validation errors
- [ ] Bridge is polling LCM ("Polling LCM" messages)
- [ ] Watcher is watching files ("Watching" messages)

---

## Regression Test (if issues found)

Run the full test suite:

```bash
cd ~/.openclaw/workspace/projects/mesh-memory
npm test 2>&1 | tail -30
```

**Expected:** All tests pass (or skip multi-agent tests if no peers).

---

## Compatibility Issues Log

| Date | OpenClaw Version | Issue | Resolution |
|------|------------------|-------|------------|
| | | | |

---

## Quick Fixes

### "Cannot find module" errors
```bash
cd ~/.openclaw/workspace/projects/mesh-memory
rm -rf node_modules package-lock.json
npm install
```

### Port already in use
```bash
# Find and kill existing process
lsof -ti:18803 | xargs kill -9 2>/dev/null || fuser -k 18803/tcp 2>/dev/null
# Restart mesh-memory
npm start
```

### Config validation errors
```bash
# Validate JSON syntax
node -e "require('./mesh-memory.config.local.json')" && echo "Config OK" || echo "Config INVALID"
# If invalid, restore from backup or recreate
```

### LCM bridge not exporting
```bash
# Check LCM database is readable
sqlite3 ~/.openclaw/lcm.db "SELECT COUNT(*) FROM summaries;" 2>/dev/null && echo "LCM OK" || echo "LCM access issue"
# Check bridge logs
tail -50 ~/.openclaw/workspace/projects/mesh-memory/bridge.log 2>/dev/null | grep -i "error\|fail"
```

---

## Contact & Escalation

If compatibility issues persist:
1. Check this document's **Compatibility Issues Log** for known issues
2. Review [DEPLOY.md](./DEPLOY.md) for detailed setup
3. Check [ARCHITECTURE.md](./ARCHITECTURE.md) for component interactions
4. File issue at https://github.com/Better-Machine/mesh-memory/issues

---

**Last updated:** 2026-04-09
**Document version:** 1.0
**Maintainer:** Liz 🐿️
