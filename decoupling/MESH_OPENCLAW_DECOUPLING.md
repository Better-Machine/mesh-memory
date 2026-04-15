# Mesh-Memory OpenClaw Decoupling Analysis

**Date:** 2026-04-13  
**Agent:** Liz 🐿️  
**Status:** CRITICAL — High coupling detected  

---

## Executive Summary

**Current State:** Mesh-memory has **EXTENSIVE** hard dependencies on OpenClaw runtime. It cannot run independently without significant refactoring.

**Risk Level:** 🔴 **HIGH** — Mesh-memory is currently an OpenClaw plugin, not a standalone service.

**Migration Effort:** Estimated 2-3 weeks for full decoupling with backward compatibility layer.

---

## 1. Dependency Inventory

### 1.1 Hardcoded Filesystem Paths (CRITICAL)

| File | Line | Current Hardcoded Path | Impact |
|------|------|------------------------|--------|
| `memory-watcher.mjs` | 15 | `~/.openclaw/workspace/memory/mesh` | Core mesh storage |
| `rotate-storage.mjs` | 14 | `~/.openclaw/workspace/memory` | Storage rotation |
| `thread-notify.mjs` | 15 | `~/.openclaw/workspace/projects/mesh-memory/memory/threads` | Thread management |
| `thread-context.mjs` | 12 | Same as above | Thread context |
| `thread-close.mjs` | 14 | Same as above | Thread lifecycle |
| `memory-receiver.mjs` | 14 | `~/.openclaw/workspace/memory/mesh` | Event reception |
| `memory-receiver.mjs` | 15 | `~/.openclaw/workspace/memory/shared/gates` | Gate protocol |
| `shared-pool-*.mjs` | 12-14 | `~/.openclaw/workspace` | Shared pool sync |
| `blind-gate.mjs` | 16 | Same | Blind gate protocol |
| `tunnel-publisher.mjs` | 17 | Same | A2A tunneling |
| `dream-cycle.mjs` | 13 | `~/.openclaw/workspace/memory` | Nightly consolidation |
| `memory-bridge.mjs` | 14-16 | `~/.openclaw/lcm.db`, `~/.openclaw/workspace/memory/lcm` | LCM integration |
| `memory-bridge.mjs` | 16 | `~/.openclaw/mesh-memory-cursor.json` | Bridge state |
| `palace-logger.mjs` | 12 | `~/.openclaw/workspace/memory/logs` | Logging |
| `palace-mvp/agent-passport.json` | — | Multiple `~/.openclaw/*` paths | Identity/config |

**Count:** 15+ unique hardcoded path references

### 1.2 OpenClaw CLI Invocations (CRITICAL)

| File | Function | Command | Purpose |
|------|----------|---------|---------|
| `thread-notify.mjs` | `sendSystemEvent()` | `openclaw system event --text ...` | User notifications |
| `setup.mjs` | Prerequisites check | `openclaw gateway status` | Gateway validation |
| `setup.mjs` | Setup guidance | `openclaw gateway start` | Startup instructions |
| `setup.mjs` | A2A verification | `curl http://localhost:18800/...` | Plugin check |

**Impact:** Cannot send user notifications without OpenClaw CLI.

### 1.3 OpenClaw Config Dependencies (HIGH)

| File | Dependency | Path | Usage |
|------|------------|------|-------|
| `setup.mjs` | Main config | `~/.openclaw/openclaw.json` | Channel allowlists, group discovery |
| `setup.mjs` | Auth profiles | `~/.openclaw/agents/main/agent/auth-profiles.json` | API keys (Together AI) |
| `identity-resolver.mjs` | Channel config | Passed as parameter | Identity resolution |

### 1.4 Environment Variable Dependencies (MEDIUM)

| Variable | Used In | Fallback | Risk |
|----------|---------|----------|------|
| `OPENCLAW_WORKSPACE` | `a2a-palace-adapter.mjs` | `process.cwd()` | Low (has fallback) |
| `OPENCLAW_WORKSPACE` | Test files | Hardcoded in tests | Medium (test only) |

### 1.5 LCM Database Coupling (HIGH)

| File | Usage | Hardcoded Path |
|------|-------|----------------|
| `memory-bridge.mjs` | Reads conversation summaries | `~/.openclaw/lcm.db` |

**Impact:** Bridge cannot function without OpenClaw's LCM (Long-term Conversation Memory) database.

---

## 2. Coupling Analysis by Component

### 2.1 Core Runtime Components

```
┌─────────────────────────────────────────────────────────────┐
│                    MESH-MEMORY SYSTEM                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   Watcher    │  │  Receiver    │  │    Bridge    │       │
│  │   🔴 CRIT    │  │   🔴 CRIT    │  │   🔴 CRIT    │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│         │                │                │                  │
│         ▼                ▼                ▼                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │           ~/.openclaw/workspace/memory/*              │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │Thread Mgmt   │  │ Dream Cycle  │  │ Setup        │       │
│  │   🔴 CRIT    │  │   🟡 HIGH    │  │   🔴 CRIT    │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│                                                              │
└─────────────────────────────────────────────────────────────┘

Legend: 🔴 CRITICAL | 🟡 HIGH | 🟢 LOW
```

### 2.2 Coupling Matrix

| Component | OpenClaw Paths | CLI Calls | Config Reads | Can Run Standalone? |
|-----------|---------------|-----------|--------------|---------------------|
| memory-watcher | 🔴 Yes | No | No | ❌ No |
| memory-receiver | 🔴 Yes | No | No | ❌ No |
| memory-bridge | 🔴 Yes | No | No | ❌ No |
| thread-notify | 🔴 Yes | 🔴 Yes | No | ❌ No |
| thread-context | 🔴 Yes | No | No | ❌ No |
| thread-close | 🔴 Yes | No | No | ❌ No |
| dream-cycle | 🔴 Yes | No | 🟡 Yes | ❌ No |
| setup.mjs | 🟡 Yes | 🔴 Yes | 🔴 Yes | ❌ No |
| blind-gate | 🔴 Yes | No | No | ❌ No |
| tunnel-publisher | 🔴 Yes | No | No | ❌ No |
| a2a-palace-adapter | 🟡 Yes | No | No | ⚠️ Partial |

---

## 3. Migration Path

### Phase 1: Configuration Extraction (Week 1)

**Goal:** Replace all hardcoded paths with configurable values.

#### 3.1.1 Create New Config Schema

Create `mesh-memory.config.schema.json`:

```json
{
  "meshStorage": {
    "type": "object",
    "required": ["basePath"],
    "properties": {
      "basePath": { "type": "string", "default": "~/.mesh-memory" },
      "meshDir": { "type": "string", "default": "{basePath}/mesh" },
      "threadsDir": { "type": "string", "default": "{basePath}/threads" },
      "logsDir": { "type": "string", "default": "{basePath}/logs" }
    }
  },
  "integrations": {
    "type": "object",
    "properties": {
      "openclaw": {
        "type": "object",
        "properties": {
          "enabled": { "type": "boolean", "default": false },
          "workspacePath": { "type": "string" },
          "lcmDbPath": { "type": "string" },
          "notificationCommand": { "type": "string" }
        }
      },
      "lcm": {
        "type": "object",
        "properties": {
          "source": { "enum": ["openclaw", "sqlite", "none"], "default": "none" },
          "dbPath": { "type": "string" }
        }
      }
    }
  },
  "notifications": {
    "type": "object",
    "properties": {
      "provider": { "enum": ["openclaw", "webhook", "file", "none"], "default": "file" },
      "webhookUrl": { "type": "string" },
      "filePath": { "type": "string" }
    }
  }
}
```

#### 3.1.2 Refactor Path Resolution

Create `lib/paths.mjs`:

```javascript
import { homedir } from "node:os";
import { resolve } from "node:path";
import { loadConfig } from "./config.mjs";

const CONFIG = loadConfig();

/**
 * Resolves a path template with variable substitution
 * Supports: ~ (homedir), {basePath}, {date}, {agentId}
 */
export function resolvePath(template, vars = {}) {
  const basePath = CONFIG.meshStorage?.basePath || "~/.mesh-memory";
  
  let resolved = template
    .replace(/^~/, homedir())
    .replace(/{basePath}/g, basePath)
    .replace(/{date}/g, new Date().toISOString().slice(0, 10))
    .replace(/{agentId}/g, CONFIG.agentId || "unknown");
    
  // Apply custom vars
  for (const [key, value] of Object.entries(vars)) {
    resolved = resolved.replace(new RegExp(`{${key}}`, 'g'), value);
  }
  
  return resolve(resolved);
}

/**
 * Get mesh directory path
 */
export function getMeshDir() {
  const override = CONFIG.meshStorage?.meshDir;
  if (override) return resolvePath(override);
  return resolvePath("{basePath}/mesh");
}

/**
 * Get threads directory path
 */
export function getThreadsDir() {
  const override = CONFIG.meshStorage?.threadsDir;
  if (override) return resolvePath(override);
  return resolvePath("{basePath}/threads");
}

// Similar functions for other paths...
```

#### 3.1.3 Update All Files

Replace in each file:

**Before:**
```javascript
const MESH_DIR = resolve(homedir(), ".openclaw/workspace/memory/mesh");
```

**After:**
```javascript
import { getMeshDir } from "./lib/paths.mjs";
const MESH_DIR = getMeshDir();
```

### Phase 2: Notification Abstraction (Week 1-2)

**Goal:** Replace `openclaw system event` with pluggable notification system.

#### 3.2.1 Create Notification Provider Interface

Create `lib/notifications.mjs`:

```javascript
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendFile } from "node:fs/promises";
import { loadConfig } from "./config.mjs";

const execFileAsync = promisify(execFile);

const PROVIDERS = {
  /**
   * File-based notification (default, standalone mode)
   */
  async file(text, options = {}) {
    const { filePath = "~/.mesh-memory/notifications.log" } = options;
    const timestamp = new Date().toISOString();
    await appendFile(
      filePath.replace(/^~/, homedir()),
      `[${timestamp}] ${text}\n`,
      "utf-8"
    );
    return { success: true, provider: "file" };
  },

  /**
   * Webhook notification
   */
  async webhook(text, options = {}) {
    const { webhookUrl } = options;
    if (!webhookUrl) throw new Error("webhookUrl required");
    
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, timestamp: new Date().toISOString() })
    });
    
    if (!res.ok) throw new Error(`Webhook failed: ${res.status}`);
    return { success: true, provider: "webhook" };
  },

  /**
   * OpenClaw system event (legacy mode)
   */
  async openclaw(text, options = {}) {
    try {
      await execFileAsync("openclaw", [
        "system", "event",
        "--text", text,
        "--mode", options.mode || "now"
      ]);
      return { success: true, provider: "openclaw" };
    } catch (err) {
      throw new Error(`OpenClaw notification failed: ${err.message}`);
    }
  },

  /**
   * No-op provider
   */
  async none() {
    return { success: true, provider: "none", note: "Notifications disabled" };
  }
};

/**
 * Send notification via configured provider
 */
export async function notify(text, options = {}) {
  const config = loadConfig();
  const provider = config.notifications?.provider || "file";
  const providerConfig = config.notifications || {};
  
  const handler = PROVIDERS[provider];
  if (!handler) {
    throw new Error(`Unknown notification provider: ${provider}`);
  }
  
  return handler(text, { ...providerConfig, ...options });
}
```

#### 3.2.2 Update thread-notify.mjs

Replace:
```javascript
await execFileAsync("openclaw", ["system", "event", "--text", text, "--mode", "now"]);
```

With:
```javascript
import { notify } from "./lib/notifications.mjs";
await notify(text, { mode: "now" });
```

### Phase 3: LCM Bridge Abstraction (Week 2)

**Goal:** Make LCM integration optional and configurable.

#### 3.3.1 Create LCM Provider Interface

Create `lib/lcm-providers.mjs`:

```javascript
import Database from "better-sqlite3";
import { loadConfig } from "./config.mjs";

const PROVIDERS = {
  /**
   * OpenClaw LCM database (legacy)
   */
  openclaw: {
    async connect() {
      const { homedir } = await import("node:os");
      const { resolve } = await import("node:path");
      const dbPath = resolve(homedir(), ".openclaw/lcm.db");
      return new Database(dbPath, { readonly: true });
    },
    
    async query(db, since) {
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table'"
      ).all().map(r => r.name);
      
      // Try common table names...
      for (const table of ["summaries", "summary", "lcm_summaries", "entries"]) {
        if (!tables.includes(table)) continue;
        // ... schema detection logic from memory-bridge.mjs
      }
    }
  },

  /**
   * Direct SQLite database
   */
  sqlite: {
    async connect() {
      const config = loadConfig();
      const dbPath = config.integrations?.lcm?.dbPath;
      if (!dbPath) throw new Error("lcm.dbPath required in config");
      return new Database(dbPath, { readonly: true });
    },
    
    async query(db, since) {
      // Standard schema expected
      return db.prepare(
        `SELECT timestamp, summary FROM summaries WHERE timestamp > ?`
      ).all(since);
    }
  },

  /**
   * No LCM (standalone mode)
   */
  none: {
    async connect() { return null; },
    async query() { return []; }
  }
};

export async function getLCMProvider() {
  const config = loadConfig();
  const source = config.integrations?.lcm?.source || "none";
  return PROVIDERS[source] || PROVIDERS.none;
}
```

### Phase 4: Setup Refactoring (Week 2-3)

**Goal:** Make setup work without OpenClaw while maintaining compatibility.

#### 3.4.1 Modularize Setup

Create `lib/setup/` directory:

```
lib/setup/
├── index.mjs          # Main orchestrator
├── prerequisites.mjs    # Environment checks
├── identity.mjs         # Agent identity setup
├── tokens.mjs           # Token generation
├── coordination.mjs     # GitHub coordination repo
└── openclaw-compat.mjs  # Optional OpenClaw integration
```

#### 3.4.2 Conditional OpenClaw Features

In `lib/setup/openclaw-compat.mjs`:

```javascript
/**
 * Detects if OpenClaw is available
 */
export async function isOpenClawAvailable() {
  try {
    const { execSync } = await import("node:child_process");
    execSync("openclaw --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Gets OpenClaw config if available
 */
export async function getOpenClawConfig() {
  if (!await isOpenClawAvailable()) return null;
  
  try {
    const { readFileSync } = await import("node:fs");
    const { homedir } = await import("node:os");
    const { resolve } = await import("node:path");
    const cfgPath = resolve(homedir(), ".openclaw/openclaw.json");
    return JSON.parse(readFileSync(cfgPath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Imports OpenClaw identities if available
 */
export async function importOpenClawIdentities(reg) {
  const openClawCfg = await getOpenClawConfig();
  if (!openClawCfg) return { imported: 0, note: "OpenClaw not available" };
  
  // Import logic from current setup.mjs...
  return { imported: count, identities };
}
```

### Phase 5: Passport Decoupling (Week 3)

**Goal:** Remove OpenClaw-specific paths from passport.

#### 3.5.1 Update Passport Schema

Current:
```json
{
  "session_cohesion": {
    "lcm_db": "~/.openclaw/agents/main/sessions/lcm.db",
    "memory_dir": "~/.openclaw/workspace/memory"
  }
}
```

New:
```json
{
  "session_cohesion": {
    "lcm_source": "openclaw",
    "lcm_db": "~/.openclaw/agents/main/sessions/lcm.db",
    "memory_storage": {
      "type": "filesystem",
      "base_path": "~/.mesh-memory"
    }
  },
  "runtime": {
    "can_run_standalone": true,
    "openclaw_integration": "optional"
  }
}
```

---

## 4. Backward Compatibility Strategy

### 4.1 Config Migration

Create `scripts/migrate-config.mjs`:

```javascript
#!/usr/bin/env node
/**
 * Migrates legacy OpenClaw-dependent config to new decoupled format
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

const LEGACY_CONFIG = resolve(process.cwd(), "mesh-memory.config.local.json");
const NEW_CONFIG = resolve(process.cwd(), "mesh-memory.config.json");

function migrate() {
  if (!existsSync(LEGACY_CONFIG)) {
    console.log("No legacy config to migrate");
    return;
  }
  
  const legacy = JSON.parse(readFileSync(LEGACY_CONFIG, "utf-8"));
  
  const migrated = {
    version: "2.0.0",
    agentId: legacy.agentId,
    receiverPort: legacy.receiverPort,
    receiverToken: legacy.receiverToken,
    
    meshStorage: {
      basePath: "~/.mesh-memory",
      // Migrate from legacy paths if needed
      migrateFrom: "~/.openclaw/workspace/memory"
    },
    
    integrations: {
      openclaw: {
        enabled: true,
        workspacePath: "~/.openclaw/workspace",
        lcmDbPath: "~/.openclaw/lcm.db"
      },
      lcm: {
        source: "openclaw"
      }
    },
    
    notifications: {
      provider: "openclaw"
    },
    
    peers: legacy.peers || []
  };
  
  writeFileSync(NEW_CONFIG, JSON.stringify(migrated, null, 2));
  console.log("Config migrated successfully");
  console.log("New config:", NEW_CONFIG);
}

migrate();
```

### 4.2 Runtime Mode Detection

In `config.mjs`:

```javascript
export function detectRuntimeMode() {
  const config = loadConfig();
  
  // Check if running with OpenClaw
  const hasOpenClaw = (() => {
    try {
      execSync("openclaw --version", { stdio: "pipe" });
      return true;
    } catch { return false; }
  })();
  
  // Check config preference
  const openclawEnabled = config.integrations?.openclaw?.enabled;
  
  if (openclawEnabled === false) {
    return "standalone";
  }
  
  if (hasOpenClaw && openclawEnabled !== false) {
    return "openclaw";
  }
  
  return "standalone";
}
```

---

## 5. Testing Strategy

### 5.1 Standalone Mode Tests

Create `tests/standalone-mode.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert";
import { tempDir, createStandaloneConfig } from "./helpers.mjs";

/**
 * Tests that mesh-memory can run without OpenClaw
 */

test("standalone: can start receiver without OpenClaw paths", async () => {
  const config = createStandaloneConfig(await tempDir());
  // Test receiver starts with custom paths...
});

test("standalone: file-based notifications work", async () => {
  // Test notifications write to file instead of OpenClaw...
});

test("standalone: mesh storage uses custom paths", async () => {
  // Verify files created in custom location...
});
```

### 5.2 Compatibility Tests

Create `tests/openclaw-compat.test.mjs`:

```javascript
/**
 * Tests backward compatibility with OpenClaw
 */

test("openclaw-compat: can use legacy paths", async () => {
  // Test with openclaw.enabled: true...
});

test("openclaw-compat: notifications use OpenClaw CLI", async () => {
  // Verify openclaw system event is called...
});
```

---

## 6. Deployment Independence

### 6.1 Systemd Service (Standalone)

Create `systemd/mesh-memory.service`:

```ini
[Unit]
Description=Mesh-Memory Agent Mesh Service
After=network.target

[Service]
Type=simple
User=%I
WorkingDirectory=/home/%I/.mesh-memory
Environment=MESH_MEMORY_MODE=standalone
Environment=MESH_CONFIG_PATH=/home/%I/.mesh-memory/config.json
ExecStart=/usr/bin/node /home/%I/.mesh-memory/mesh-memory.mjs start
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### 6.2 Docker Support

Create `Dockerfile`:

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

ENV MESH_MEMORY_MODE=standalone
ENV MESH_CONFIG_PATH=/app/config/mesh-memory.json

EXPOSE 18803

CMD ["node", "mesh-memory.mjs", "start"]
```

---

## 7. Migration Checklist

### Pre-Migration
- [ ] Backup existing `~/.openclaw/workspace/memory`
- [ ] Export current config to `mesh-memory.config.local.json.backup`
- [ ] Document current peer configuration
- [ ] Verify all nodes can be updated

### Phase 1: Config
- [ ] Create new config schema
- [ ] Run migration script
- [ ] Verify paths resolve correctly
- [ ] Test with `--dry-run`

### Phase 2: Notifications
- [ ] Set `notifications.provider: "file"`
- [ ] Verify notifications write to log file
- [ ] Test webhook provider if needed
- [ ] Keep OpenClaw as fallback

### Phase 3: Storage
- [ ] Set `meshStorage.basePath: "~/.mesh-memory"`
- [ ] Copy existing data: `cp -r ~/.openclaw/workspace/memory ~/.mesh-memory`
- [ ] Verify all files accessible
- [ ] Update palace-mvp paths

### Phase 4: Validation
- [ ] Run full test suite
- [ ] Test peer-to-peer communication
- [ ] Verify thread notifications work
- [ ] Run stress test

### Phase 5: Cleanup
- [ ] Stop OpenClaw-dependent services (if desired)
- [ ] Remove OpenClaw config dependencies (optional)
- [ ] Document new deployment process
- [ ] Update README and DEPLOY.md

---

## 8. Summary

| Metric | Before | After |
|--------|--------|-------|
| Hardcoded OpenClaw paths | 15+ | 0 |
| Required OpenClaw CLI calls | 3 | 0 (optional) |
| Can run standalone | ❌ No | ✅ Yes |
| Deployment options | OpenClaw only | OpenClaw, systemd, Docker, etc. |
| Configuration flexibility | Low | High |
| Migration complexity | N/A | Medium |

**Recommendation:** Proceed with phased migration starting with Phase 1 (config extraction). Each phase can be deployed independently and rolled back if issues arise.

---

*Document generated by Liz as part of OpenClaw decoupling analysis.*
