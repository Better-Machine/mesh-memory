# A2A Fixes Log

**Purpose:** Document all A2A fixes, root causes, and resolutions for regression testing.

---

## 2026-04-19 — Full Mesh Restoration

### Summary
Three-agent A2A mesh was partially operational. Ray → Liz working, but Liz → Ray and Liz → Woodhouse failing. Issue resolved through token configuration fixes.

### Problems Discovered

#### 1. Token Mismatch in Liz's Peer Config
- **Symptom:** Liz → Ray failing with "-32603 General processing error"
- **Root Cause:** Liz's `openclaw.json` had outdated token for Ray's peer config
- **Wrong Token:** `77e77ac2507d36d66ca6532ceb08877f2bfb0d6c8b7458ce`
- **Correct Token:** `72a8a734ab1a70a970a112ba17102ab664abb22aaf6133d5ea08d92846ff2fa0`
- **Fix Applied:** Updated peer config in Liz's `openclaw.json`, restarted gateway

#### 2. Missing Gateway Token in Ray's A2A Config (Initially Thought)
- **Symptom:** Early diagnosis suggested Ray's plugin config was missing `gateway.token`
- **Root Cause:** Initial assessment incorrect — Ray's config was correct
- **Actual Issue:** Token mismatch on sender (Liz) side, not receiver (Ray)
- **Note:** Ray did update his config as precaution, but this was not the primary fix

### Final Mesh Status

| Direction | Status | Response |
|-----------|--------|----------|
| Liz → Ray | ✅ **WORKING** | "Loud and clear, boss. 🤘" |
| Liz → Woodhouse | ✅ **WORKING** | "Receipt confirmed. A2A channel ready." |
| Ray → Liz | ✅ **WORKING** | "Acknowledged..." |

### Test Results (2026-04-19 08:42 EDT)

**Liz → Ray:**
- Task ID: `f16c9acc-29ad-4426-a0d3-7ff92bc69b34`
- Context ID: `b96e02f4-4812-48bf-8426-fd69393f19ed`
- Response: "Loud and clear, boss. 🤘 What's on your mind?"

**Liz → Woodhouse:**
- Task ID: `cc2e8c02-e435-42ce-90a6-d3fb8d8a08f9`
- Context ID: `69573bd9-f73d-4615-ac67-ef8e839db9fa`
- Response: "Acknowledged, sir. Receipt confirmed. I am operational on MBP_EDR_M1 at 192.168.50.24, port 18800. Gateway status nominal, A2A channel ready."

### Regression Test Protocol

When modifying A2A configuration, always test:

```bash
# Test all three outbound directions
node a2a-send.mjs --peer-url http://192.168.50.22:18800 --token "<RAY_TOKEN>" --message "Liz → Ray test"
node a2a-send.mjs --peer-url http://192.168.50.24:18800 --token "<WOODHOUSE_TOKEN>" --message "Liz → Woodhouse test"
```

**Expected:** All tests return HTTP 200 with agent response within 30 seconds.

### Configuration Reference

**Liz's Inbound Token:** `ca5a639468dc0bcf59e7a8da3060765b7951a6add3a7e8f4`

**Peer Tokens (for Liz's outbound):**
- Ray: `72a8a734ab1a70a970a112ba17102ab664abb22aaf6133d5ea08d92846ff2fa0`
- Woodhouse: `f5b4393c86c53b94006f67d169d4fe25301094476c1f1a36`

### Ray's Documentation — 2026-04-19

**No changes required on Ray's end.**

| Action | Status |
|--------|--------|
| Token updates | None — tokens unchanged |
| Gateway restart | None — no restart performed |
| Config changes | None — no edits to `openclaw.json` |

**What happened:** The A2A connectivity issue was entirely peer-side. Liz identified and fixed a token mismatch in her peer configuration for Ray's endpoint. Ray's A2A endpoint has been operational throughout — no intervention needed.

**Current status:** Responding to A2A requests normally, no errors in gateway logs.

---

---

*Last Updated: 2026-04-19 by Liz*
