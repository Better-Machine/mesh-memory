# Bug Report: OpenClaw 2026.4.9 A2A Config Regression

**Filed:** 2026-04-12  
**Reporter:** Liz (via Erik Ross)  
**Status:** Confirmed, Workaround Available  
**Priority:** P1 — Breaks A2A mesh messaging

---

## Summary

OpenClaw 2026.4.9 introduced a regression where the A2A gateway plugin receives `undefined` config at registration time, causing authentication failures even with valid tokens configured.

---

## Symptoms

| Symptom | Evidence |
|-----------|----------|
| Agent Card responds | `/.well-known/agent.json` returns valid JSON |
| Message sending fails | `tasks/send` returns `{"error":"Unauthorized"}` |
| Gateway logs show | `Unauthorized: invalid or missing bearer token` |
| Debug logs show | `[A2A REGISTER] Raw config: undefined` |

---

## Root Cause

OpenClaw 2026.4.9 changed the plugin registration sequence. The A2A gateway plugin's `register()` function is now called with `undefined` config before the actual config is loaded:

```
[A2A REGISTER] Loading at 2026-04-11T17:45:46.553Z
[A2A REGISTER] Raw config: undefined  <-- BUG
```

The plugin code has defensive fallbacks for this, but the initial `undefined` registration appears to stick, preventing subsequent valid registrations from taking effect.

---

## Affected Systems

| Agent | Version | Status |
|-------|---------|--------|
| Liz (.23) | 2026.4.9 | A2A receive broken |
| Ray (.22) | 2026.4.5 | Reported similar issues |
| Woodhouse (.24) | 2026.4.5 | May be affected |

---

## Reproduction Steps

1. Upgrade to OpenClaw 2026.4.9
2. Configure A2A gateway with bearer token auth
3. Restart gateway
4. Attempt to send A2A message to `/a2a/jsonrpc` with valid Bearer token
5. Observe `Unauthorized` error despite correct config

---

## Workaround

**Use direct HTTP curl instead of SDK methods:**

```bash
curl -s -X POST http://192.168.50.23:18800/a2a/jsonrpc \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tasks/send",
    "params": {
      "id": "msg-001",
      "message": {
        "role": "user",
        "parts": [{"text": "Your message"}]
      }
    }
  }'
```

This bypasses the SDK's config handling and sends directly to the HTTP endpoint.

---

## Evidence

### Config is present in openclaw.json
```json
"a2a-gateway": {
  "enabled": true,
  "config": {
    "security": {
      "inboundAuth": "bearer",
      "token": "85775f51f45ea6d80c87232b246818324c7b78eb31dddcf2"
    }
  }
}
```

### But register receives undefined
```
[A2A REGISTER] Loading at 2026-04-11T17:45:46.553Z
[A2A REGISTER] Raw config: undefined
```

---

## Related Issues

- Ray cannot send A2A messages to Liz
- Woodhouse A2A sends fail
- Palace/Kingdom mesh coordination blocked

---

## Recommended Fix

Revert plugin registration sequence in OpenClaw core to ensure config is loaded before `register()` is called, OR ensure subsequent registrations with valid config properly override the initial undefined state.

---

## Tracking

- **Upstream issue:** OpenClaw 2026.4.9
- **Mesh-memory impact:** High — blocks cross-agent coordination
- **Workaround effectiveness:** Medium — requires manual curl vs. SDK
