# Mesh-Memory OpenClaw Plugin Architecture

**Document ID:** MESH-PLUGIN-ARCH-001  
**Version:** 1.0.0  
**Date:** 2026-04-13  
**Author:** Liz (Infrastructure Architect)  
**Status:** Draft — Pending RFC Review  

---

## Executive Summary

This document specifies the architecture for integrating mesh-memory as a first-class OpenClaw plugin. The design enables mesh-memory to leverage OpenClaw's lifecycle management, configuration system, and event hooks while maintaining graceful degradation and version compatibility.

**Key Decisions:**
- Mesh-memory becomes an OpenClaw extension with `kind: "memory"` and `kind: "gateway"` hybrid
- Plugin integrates with OpenClaw gateway startup/shutdown events
- Configuration is unified under OpenClaw's `openclaw.json` with mesh-memory extension
- API surface exposed via OpenClaw's internal HTTP routing
- Systemd/launchd continue as underlying process managers (OpenClaw delegates)

---

## 1. Plugin Manifest Structure

### 1.1 Primary Plugin Manifest: `openclaw.plugin.json`

```json
{
  "$schema": "https://openclaw.io/schemas/plugin-v1.json",
  "id": "mesh-memory",
  "name": "Mesh Memory — Multi-Agent Shared Memory System",
  "description": "Distributed shared memory and collaboration layer for multi-agent A2A mesh",
  "version": "1.0.0",
  "kind": ["memory", "gateway-extension"],
  "channels": ["a2a", "memory", "system"],
  "providers": ["mesh-memory"],
  
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["agentId"],
    "properties": {
      "agentId": {
        "type": "string",
        "description": "Unique identifier for this agent in the mesh",
        "enum": ["liz", "ray", "woodhouse"]
      },
      "receiver": {
        "type": "object",
        "properties": {
          "port": { "type": "number", "default": 18803 },
          "bindAddress": { "type": "string", "default": "0.0.0.0" },
          "authToken": { "type": "string", "secret": true },
          "maxConnections": { "type": "number", "default": 100 }
        }
      },
      "threadManager": {
        "type": "object",
        "properties": {
          "port": { "type": "number", "default": 18802 },
          "enabled": { "type": "boolean", "default": true }
        }
      },
      "peers": {
        "type": "array",
        "description": "Other agents in the mesh",
        "items": {
          "type": "object",
          "properties": {
            "agentId": { "type": "string" },
            "url": { "type": "string", "format": "uri" },
            "threadUrl": { "type": "string", "format": "uri" },
            "token": { "type": "string", "secret": true }
          },
          "required": ["agentId", "url", "token"]
        }
      },
      "storage": {
        "type": "object",
        "properties": {
          "backend": { "type": "string", "enum": ["local", "mem0"], "default": "local" },
          "meshPath": { "type": "string", "default": "~/.openclaw/workspace/memory/mesh/" },
          "sharedPoolPath": { "type": "string", "default": "~/.openclaw/workspace/memory/shared/gates/" }
        }
      },
      "features": {
        "type": "object",
        "description": "Feature flags for gradual rollout",
        "properties": {
          "consensusProtocol": { "type": "boolean", "default": false },
          "trustScoring": { "type": "boolean", "default": true },
          "hotReload": { "type": "boolean", "default": true },
          "vectorSearch": { "type": "boolean", "default": false }
        }
      },
      "compatibility": {
        "type": "object",
        "properties": {
          "minOpenClawVersion": { "type": "string", "default": "0.15.0" },
          "maxOpenClawVersion": { "type": "string" },
          "deprecatedApis": { "type": "array", "items": { "type": "string" } }
        }
      }
    }
  },
  
  "uiHints": {
    "agentId": { "label": "Agent ID", "help": "Your unique name in the mesh (liz/ray/woodhouse)" },
    "receiver.port": { "label": "Receiver Port", "help": "HTTP port for mesh events (default 18803)" },
    "receiver.authToken": { "label": "Auth Token", "help": "Secret token for inter-agent authentication", "sensitive": true },
    "storage.backend": { "label": "Storage Backend", "help": "local=file-based, mem0=external service" },
    "features.consensusProtocol": { "label": "Enable Consensus Protocol", "help": "Beta: distributed consensus for critical decisions" }
  },
  
  "lifecycle": {
    "hooks": ["gateway:startup", "gateway:shutdown", "config:reload", "health:check"]
  },
  
  "api": {
    "routes": [
      { "path": "/mesh/send", "method": "POST", "handler": "sendMessage" },
      { "path": "/mesh/threads", "method": "GET", "handler": "listThreads" },
      { "path": "/mesh/memory/search", "method": "GET", "handler": "searchMemory" },
      { "path": "/mesh/memory/write", "method": "POST", "handler": "writeMemory" },
      { "path": "/mesh/health", "method": "GET", "handler": "healthCheck" }
    ]
  }
}
```

### 1.2 Manifest Design Rationale

| Field | Purpose | Mapping to Implementation |
|-------|---------|---------------------------|
| `kind: ["memory", "gateway-extension"]` | Declares dual role: memory provider + gateway extension | Registers with both subsystems |
| `channels: ["a2a", "memory", "system"]` | Declares event channels this plugin consumes | Event router subscription |
| `configSchema` | Full JSON Schema for validation | Used by OpenClaw config loader |
| `lifecycle.hooks` | Declares which hooks plugin implements | Gateway calls these at lifecycle points |
| `api.routes` | HTTP routes exposed by plugin | Mounted under gateway's HTTP server |

---

## 2. Lifecycle Hooks

### 2.1 Hook Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         OpenClaw Gateway Lifecycle                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  BOOT ─────────► STARTUP ────────► RUNNING ────────► SHUTDOWN ─────► STOP │
│    │                 │                 │                 │                    │
│    ▼                 ▼                 ▼                 ▼                    │
│  ┌──────────┐   ┌──────────┐     ┌──────────┐     ┌──────────┐              │
│  │ manifest │   │ validate │     │ message  │     │ graceful │              │
│  │  load    │   │   config │     │ received │     │ shutdown │              │
│  │          │   │ spawn    │     │ presence │     │          │              │
│  │          │   │ services │     │ updated  │     │          │              │
│  └──────────┘   └──────────┘     └──────────┘     └──────────┘              │
│                                                                             │
│  mesh-memory actions:                                                       │
│  ─────────────────────                                                     │
│  • Register self with                       • Stop accepting new           │
│    plugin registry                            messages                     │
│  • Load/validate config    • Relay messages • Flush pending writes         │
│  • Spawn receiver/bridge   • Update peer    • Notify peers               │
│    services                  • status         • Cleanup sockets              │
│  • Announce presence         • Log to mesh                               │
│    to peers                                                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Implementation: `gateway:startup`

```typescript
// mesh-plugin.ts — Gateway Startup Hook

export async function onGatewayStartup(ctx: PluginContext): Promise<StartupResult> {
  const log = ctx.logger.child({ hook: "gateway:startup" });
  
  // 1. Version Compatibility Check
  const openClawVersion = ctx.gateway.version;
  const minVersion = ctx.config.compatibility?.minOpenClawVersion ?? "0.15.0";
  
  if (!satisfies(openClawVersion, ">=" + minVersion)) {
    log.error({ openClawVersion, minVersion }, "OpenClaw version incompatible");
    return {
      status: "degraded",
      capabilities: { mesh: false, memory: false },
      warning: `OpenClaw ${openClawVersion} < required ${minVersion}. Mesh features disabled.`
    };
  }
  
  // 2. Config Validation
  const config = ctx.config as MeshConfig;
  const validation = validateMeshConfig(config);
  if (!validation.valid) {
    log.error({ errors: validation.errors }, "Config validation failed");
    return {
      status: "failed",
      error: `Invalid config: ${validation.errors.join(", ")}`
    };
  }
  
  // 3. Feature Flag Resolution
  const features = resolveFeatureFlags(ctx);
  log.info({ features }, "Feature flags resolved");
  
  // 4. Service Spawning (delegated to systemd/launchd)
  const services = [];
  
  if (!ctx.config.features?.hotReload) {
    // Cold start: register with systemd/launchd
    services.push(await registerWithSystemd("mesh-receiver", config.receiver));
    if (config.threadManager?.enabled !== false) {
      services.push(await registerWithSystemd("thread-manager", config.threadManager));
    }
    services.push(await registerWithSystemd("memory-bridge", config));
  }
  
  // 5. Health Check Registration
  ctx.health.registerCheck("mesh-receiver", async () => {
    return await checkReceiverHealth(config.receiver.port);
  });
  
  // 6. Event Channel Registration
  ctx.events.subscribe("a2a:message:received", handleA2AMessage);
  ctx.events.subscribe("agent:presence:change", handlePresenceChange);
  ctx.events.subscribe("system:event", handleSystemEvent);
  
  // 7. API Route Registration
  ctx.api.mount("/mesh", meshRouter);
  
  // 8. Peer Presence Announcement
  await announcePresenceToPeers(config);
  
  log.info("Mesh-memory plugin startup complete");
  
  return {
    status: "healthy",
    capabilities: { mesh: true, memory: true, threads: config.threadManager?.enabled !== false }
  };
}
```

### 2.3 Implementation: `gateway:shutdown`

```typescript
// mesh-plugin.ts — Gateway Shutdown Hook

export async function onGatewayShutdown(ctx: PluginContext): Promise<void> {
  const log = ctx.logger.child({ hook: "gateway:shutdown" });
  
  // 1. Stop accepting new work
  ctx.events.unsubscribeAll();
  
  // 2. Notify peers of impending shutdown
  await notifyPeersShutdown(ctx.config);
  
  // 3. Flush pending writes to shared pool
  await flushPendingWrites();
  
  // 4. Graceful service shutdown (delegated)
  await Promise.race([
    gracefulShutdownServices(),
    sleep(5000) // 5s timeout
  ]);
  
  // 5. Cleanup
  await cleanupSockets();
  
  log.info("Mesh-memory plugin shutdown complete");
}
```

### 2.4 Implementation: `config:reload`

```typescript
// mesh-plugin.ts — Config Reload Hook

export async function onConfigReload(ctx: PluginContext, newConfig: MeshConfig): Promise<ConfigReloadResult> {
  const log = ctx.logger.child({ hook: "config:reload" });
  
  // Validate new config
  const validation = validateMeshConfig(newConfig);
  if (!validation.valid) {
    log.error({ errors: validation.errors }, "New config invalid, rejecting reload");
    return { status: "rejected", errors: validation.errors };
  }
  
  // Calculate delta
  const delta = diffConfig(ctx.config, newConfig);
  
  // Apply non-breaking changes
  if (delta.peers) {
    await updatePeerList(delta.peers);
  }
  if (delta.features) {
    await updateFeatureFlags(delta.features);
  }
  
  // Schedule breaking changes for next restart
  if (delta.receiver?.port) {
    log.warn("Receiver port change requires restart, queued");
    ctx.deferUntilRestart({ portChange: delta.receiver.port });
  }
  
  return { status: "applied", changes: Object.keys(delta) };
}
```

---

## 3. Configuration Schema Design

### 3.1 Configuration Inheritance

```
┌─────────────────────────────────────────────────────────────────┐
│                      Configuration Hierarchy                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐                                            │
│  │ openclaw.json   │  Base OpenClaw config                      │
│  │ (system)        │                                            │
│  └────────┬────────┘                                            │
│           │                                                       │
│  ┌────────▼────────┐  ┌───────────────────────────────────────┐  │
│  │ plugins.mesh-   │  │ "mesh-memory" extension block         │  │
│  │ memory { ... }  │  │ All mesh-memory config lives here     │  │
│  └────────┬────────┘  └───────────────────────────────────────┘  │
│           │                                                       │
│  ┌────────▼────────────────────────────────────────────────┐    │
│  │ mesh-memory.config.local.json (optional legacy support) │    │
│  │ Fallback if not in openclaw.json — deprecated            │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Full Configuration Example

```json
{
  "gateway": {
    "port": 18800,
    "host": "0.0.0.0"
  },
  
  "plugins": {
    "mesh-memory": {
      "agentId": "liz",
      
      "receiver": {
        "port": 18803,
        "bindAddress": "0.0.0.0",
        "authToken": "${MESH_RECEIVER_TOKEN}",
        "maxConnections": 100
      },
      
      "threadManager": {
        "port": 18802,
        "enabled": true
      },
      
      "peers": [
        {
          "agentId": "ray",
          "url": "http://ray-node:18803",
          "threadUrl": "http://ray-node:18802",
          "token": "${RAY_MESH_TOKEN}"
        },
        {
          "agentId": "woodhouse",
          "url": "http://woodhouse-node:18803",
          "threadUrl": "http://woodhouse-node:18802",
          "token": "${WOODHOUSE_MESH_TOKEN}"
        }
      ],
      
      "storage": {
        "backend": "local",
        "meshPath": "~/.openclaw/workspace/memory/mesh/",
        "sharedPoolPath": "~/.openclaw/workspace/memory/shared/gates/"
      },
      
      "features": {
        "consensusProtocol": false,
        "trustScoring": true,
        "hotReload": true,
        "vectorSearch": false
      },
      
      "compatibility": {
        "minOpenClawVersion": "0.15.0",
        "deprecatedApis": ["v1/shared-pool"]
      }
    }
  }
}
```

### 3.3 Environment Variable Substitution

OpenClaw supports `${VAR_NAME}` syntax for sensitive values:

```json
{
  "receiver": {
    "authToken": "${MESH_RECEIVER_TOKEN}"
  }
}
```

Resolution order:
1. Environment variable
2. OpenClaw secrets store (if configured)
3. Prompt on first startup (interactive mode only)
4. Fail validation if required and missing

---

## 4. API Surface Implementation

### 4.1 Route Registration

```typescript
// api/mesh-router.ts

import { Router } from "express";

export function createMeshRouter(ctx: PluginContext): Router {
  const router = Router();
  
  // POST /mesh/send — Send message to peer
  router.post("/send", async (req, res) => {
    const { peerId, message, priority = "normal" } = req.body;
    
    // Validate peer exists
    const peer = ctx.config.peers.find(p => p.agentId === peerId);
    if (!peer) {
      return res.status(404).json({ error: `Peer ${peerId} not found` });
    }
    
    // Send via mesh transport
    const result = await ctx.mesh.send(peer, message, { priority });
    
    res.json({ 
      status: result.success ? "sent" : "queued",
      messageId: result.messageId,
      latency: result.latency
    });
  });
  
  // GET /mesh/threads — List active collaboration threads
  router.get("/threads", async (req, res) => {
    const { agentId, status, limit = 50 } = req.query;
    
    const threads = await ctx.mesh.threads.list({
      agentId: agentId as string,
      status: status as ThreadStatus,
      limit: parseInt(limit as string)
    });
    
    res.json({ threads, total: threads.length });
  });
  
  // GET /mesh/memory/search — Search shared memory pool
  router.get("/memory/search", async (req, res) => {
    const { q, scope = "all", filters, limit = 20 } = req.query;
    
    if (!q || typeof q !== "string") {
      return res.status(400).json({ error: "Query parameter 'q' required" });
    }
    
    const results = await ctx.mesh.memory.search({
      query: q,
      scope: scope as "facts" | "interpretations" | "all",
      filters: filters ? JSON.parse(filters as string) : undefined,
      limit: parseInt(limit as string)
    });
    
    res.json({ results, query: q });
  });
  
  // POST /mesh/memory/write — Write to shared pool
  router.post("/memory/write", async (req, res) => {
    const { type, content, source, confidence = 1.0 } = req.body;
    
    if (!["fact", "interpretation"].includes(type)) {
      return res.status(400).json({ 
        error: "Invalid type. Must be 'fact' or 'interpretation'" 
      });
    }
    
    const entry = await ctx.mesh.memory.write({
      type: type as "fact" | "interpretation",
      content,
      source: source ?? ctx.config.agentId,
      confidence,
      timestamp: new Date().toISOString()
    });
    
    res.status(201).json({ entry });
  });
  
  // GET /mesh/health — Health check
  router.get("/health", async (req, res) => {
    const health = await ctx.mesh.health.check();
    const statusCode = health.status === "healthy" ? 200 : 
                       health.status === "degraded" ? 200 : 503;
    
    res.status(statusCode).json(health);
  });
  
  return router;
}
```

### 4.2 API Response Schema

```typescript
// types/api.ts

interface MeshSendResponse {
  status: "sent" | "queued" | "failed";
  messageId: string;
  latency: number;  // milliseconds
  peerStatus?: "online" | "offline" | "degraded";
}

interface MeshThreadsResponse {
  threads: Thread[];
  total: number;
}

interface Thread {
  id: string;
  participants: string[];
  status: "open" | "closed" | "pending";
  createdAt: string;
  lastActivityAt: string;
  messageCount: number;
}

interface MeshSearchResponse {
  results: MemoryEntry[];
  query: string;
  scope: "facts" | "interpretations" | "all";
  filters?: Record<string, unknown>;
}

interface MemoryEntry {
  id: string;
  type: "fact" | "interpretation";
  content: string;
  source: string;
  confidence: number;
  timestamp: string;
  peers: string[];  // Which peers have acknowledged
}

interface MeshHealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  agentId: string;
  services: {
    receiver: "ok" | "degraded" | "down";
    threadManager: "ok" | "degraded" | "down" | "disabled";
    bridge: "ok" | "degraded" | "down";
  };
  peers: Array<{
    agentId: string;
    status: "online" | "offline" | "degraded";
    lastSeen: string;
  }>;
  features: Record<string, boolean>;
}
```

---

## 5. Event Hooks

### 5.1 Gateway Message → Mesh Relay

```typescript
// handlers/a2a-message.ts

export async function handleA2AMessage(event: A2AMessageEvent, ctx: PluginContext): Promise<void> {
  const log = ctx.logger.child({ handler: "a2a-message" });
  
  // Extract mesh-relevant metadata
  const meshEvent: MeshEvent = {
    type: "a2a:received",
    timestamp: new Date().toISOString(),
    sourceAgent: event.sender,
    targetAgent: ctx.config.agentId,
    content: event.message.text,
    metadata: {
      threadId: event.threadId,
      sessionId: event.sessionId,
      priority: event.priority
    }
  };
  
  // Write to local mesh log
  await ctx.mesh.localLog.append(meshEvent);
  
  // If relay enabled, forward to interested peers
  if (event.metadata?.relayToPeers) {
    const peers = ctx.config.peers.filter(p => 
      event.metadata.relayToPeers.includes(p.agentId)
    );
    
    for (const peer of peers) {
      try {
        await ctx.mesh.send(peer, meshEvent, { priority: "low" });
      } catch (err) {
        log.warn({ peer: peer.agentId, err }, "Failed to relay to peer");
      }
    }
  }
  
  // Update shared pool if message contains shared facts
  if (event.metadata?.sharedFacts) {
    await ctx.mesh.memory.write({
      type: "fact",
      content: event.metadata.sharedFacts,
      source: event.sender,
      timestamp: meshEvent.timestamp
    });
  }
}
```

### 5.2 Agent Presence Updates

```typescript
// handlers/presence.ts

export async function handlePresenceChange(event: PresenceEvent, ctx: PluginContext): Promise<void> {
  const { agentId, status, previousStatus } = event;
  
  // Update local peer registry
  await ctx.mesh.peers.updateStatus(agentId, status, {
    lastSeen: new Date().toISOString()
  });
  
  // Log state transition
  if (previousStatus !== status) {
    await ctx.mesh.localLog.append({
      type: "presence:change",
      agentId,
      from: previousStatus,
      to: status,
      timestamp: new Date().toISOString()
    });
  }
  
  // If peer came online, sync pending messages
  if (previousStatus === "offline" && status === "online") {
    await ctx.mesh.sync.flushQueue(agentId);
  }
}
```

### 5.3 System Event Logging

```typescript
// handlers/system-event.ts

export async function handleSystemEvent(event: SystemEvent, ctx: PluginContext): Promise<void> {
  // Filter to mesh-relevant events
  const relevantTypes = [
    "gateway:startup", "gateway:shutdown",
    "plugin:load", "plugin:unload",
    "error:critical"
  ];
  
  if (!relevantTypes.includes(event.type)) return;
  
  // Write to mesh system log
  await ctx.mesh.localLog.append({
    type: "system",
    subtype: event.type,
    timestamp: event.timestamp,
    details: sanitizeForLogging(event.details)
  });
}
```

---

## 6. Version Compatibility Strategy

### 6.1 Compatibility Matrix

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Version Compatibility Matrix                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Mesh-Memory    │  Min OpenClaw  │  Max OpenClaw  │  Notes           │
│  ─────────────────────────────────────────────────────────────────  │
│  1.0.x          │  0.15.0        │  0.16.x        │  Initial release │
│  1.1.x          │  0.16.0        │  0.18.x        │  Adds vector     │
│                 │                │                │  search feature  │
│  2.0.x          │  0.18.0        │  -             │  Breaking API    │
│                 │                │                │  changes         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.2 Runtime Compatibility Check

```typescript
// version-check.ts

import { satisfies, minVersion } from "semver";

export function checkCompatibility(
  meshVersion: string,
  openClawVersion: string,
  config: MeshConfig
): CompatibilityResult {
  const minRequired = config.compatibility?.minOpenClawVersion ?? "0.15.0";
  const maxAllowed = config.compatibility?.maxOpenClawVersion;
  
  // Check minimum version
  if (!satisfies(openClawVersion, ">=" + minRequired)) {
    return {
      compatible: false,
      status: "incompatible",
      reason: `OpenClaw ${openClawVersion} is below minimum ${minRequired}`,
      action: "upgrade"
    };
  }
  
  // Check maximum version (if specified)
  if (maxAllowed && !satisfies(openClawVersion, "<=" + maxAllowed)) {
    return {
      compatible: true,  // Still compatible, but warn
      status: "deprecated",
      reason: `OpenClaw ${openClawVersion} exceeds tested version ${maxAllowed}`,
      action: "review",
      warning: "This combination has not been tested. Some features may not work."
    };
  }
  
  // Check for deprecated APIs
  const deprecatedInUse = config.compatibility?.deprecatedApis?.filter(api => {
    // Check if API is used in current config
    return isDeprecatedApiUsed(api, config);
  }) ?? [];
  
  if (deprecatedInUse.length > 0) {
    return {
      compatible: true,
      status: "deprecated-apis",
      deprecatedApis: deprecatedInUse,
      warning: `Deprecated APIs in use: ${deprecatedInUse.join(", ")}`
    };
  }
  
  return { compatible: true, status: "compatible" };
}
```

### 6.3 Graceful Degradation Levels

```typescript
// degradation.ts

interface DegradationLevel {
  name: string;
  condition: (ctx: PluginContext) => boolean;
  capabilities: MeshCapabilities;
  actions: () => Promise<void>;
}

const degradationLevels: DegradationLevel[] = [
  {
    name: "full",
    condition: ctx => ctx.health.status === "healthy",
    capabilities: { mesh: true, memory: true, threads: true },
    actions: async () => { /* normal operation */ }
  },
  {
    name: "local-only",
    condition: ctx => ctx.health.status === "degraded" && ctx.mesh.peers.onlineCount === 0,
    capabilities: { mesh: false, memory: true, threads: true },
    actions: async () => {
      // Disable peer operations, keep local storage
      await ctx.mesh.transport.disablePeers();
      await ctx.mesh.localLog.append({
        type: "degradation",
        level: "local-only",
        reason: "No peers reachable"
      });
    }
  },
  {
    name: "read-only",
    condition: ctx => ctx.health.status === "unhealthy" && ctx.mesh.localStorage.writable === false,
    capabilities: { mesh: false, memory: "read-only", threads: false },
    actions: async () => {
      // Disable all writes, allow reads
      ctx.mesh.memory.setReadOnly(true);
      ctx.logger.warn("Operating in read-only mode");
    }
  },
  {
    name: "disabled",
    condition: ctx => ctx.compatibility.compatible === false,
    capabilities: { mesh: false, memory: false, threads: false },
    actions: async () => {
      // Full shutdown of mesh features
      await ctx.mesh.shutdown();
      ctx.logger.error("Mesh-memory disabled due to incompatibility");
    }
  }
];

export async function applyDegradationLevel(ctx: PluginContext): Promise<void> {
  for (const level of degradationLevels) {
    if (level.condition(ctx)) {
      await level.actions();
      ctx.mesh.currentCapabilities = level.capabilities;
      break;
    }
  }
}
```

---

## 7. Feature Flag System

### 7.1 Feature Flag Definition

```typescript
// features.ts

interface FeatureFlag {
  name: string;
  default: boolean;
  description: string;
  since: string;      // OpenClaw version when introduced
  deprecated?: string; // OpenClaw version when deprecated
}

const featureFlags: Record<string, FeatureFlag> = {
  consensusProtocol: {
    name: "consensusProtocol",
    default: false,
    description: "Distributed consensus for critical decisions",
    since: "0.16.0",
    deprecated: undefined
  },
  trustScoring: {
    name: "trustScoring",
    default: true,
    description: "Peer trust scoring and circuit breaker",
    since: "0.15.0"
  },
  hotReload: {
    name: "hotReload",
    default: true,
    description: "Configuration hot-reload without restart",
    since: "0.15.0"
  },
  vectorSearch: {
    name: "vectorSearch",
    default: false,
    description: "Vector-based semantic search in shared pool",
    since: "0.17.0"
  },
  sharedPoolV2: {
    name: "sharedPoolV2",
    default: false,
    description: "New shared pool API with fact/interpretation separation",
    since: "0.18.0"
  }
};

export function resolveFeatureFlags(ctx: PluginContext): ResolvedFeatures {
  const resolved: Record<string, boolean> = {};
  const userConfig = ctx.config.features ?? {};
  
  for (const [key, flag] of Object.entries(featureFlags)) {
    // User config takes precedence
    if (userConfig[key] !== undefined) {
      resolved[key] = userConfig[key];
    } else {
      // Check if OpenClaw version supports this feature
      const supported = satisfies(ctx.gateway.version, ">=" + flag.since);
      resolved[key] = supported && flag.default;
    }
    
    // Check deprecation
    if (flag.deprecated && satisfies(ctx.gateway.version, ">=" + flag.deprecated)) {
      ctx.logger.warn({ feature: key }, "Feature is deprecated in this OpenClaw version");
    }
  }
  
  return resolved;
}
```

### 7.2 Feature Flag Usage Pattern

```typescript
// Usage in code

export async function performCriticalDecision(ctx: PluginContext, decision: Decision): Promise<void> {
  if (ctx.features.consensusProtocol) {
    // Use distributed consensus
    await ctx.mesh.consensus.propose(decision);
  } else {
    // Fallback: single-agent decision with logging
    ctx.logger.warn("Consensus protocol disabled, making unilateral decision");
    await executeDecision(decision);
    await ctx.mesh.localLog.append({
      type: "decision",
      mode: "unilateral",
      decision: decision.id
    });
  }
}
```

---

## 8. Error Handling and Graceful Degradation

### 8.1 Error Classification

```typescript
// errors.ts

export enum MeshErrorCode {
  // Transport errors
  PEER_UNREACHABLE = "MESH_PEER_UNREACHABLE",
  TIMEOUT = "MESH_TIMEOUT",
  AUTH_FAILED = "MESH_AUTH_FAILED",
  
  // Storage errors
  STORAGE_FULL = "MESH_STORAGE_FULL",
  STORAGE_CORRUPT = "MESH_STORAGE_CORRUPT",
  
  // Protocol errors
  INVALID_MESSAGE = "MESH_INVALID_MESSAGE",
  VERSION_MISMATCH = "MESH_VERSION_MISMATCH",
  
  // System errors
  SERVICE_DOWN = "MESH_SERVICE_DOWN",
  CONFIG_INVALID = "MESH_CONFIG_INVALID"
}

export class MeshError extends Error {
  constructor(
    public code: MeshErrorCode,
    message: string,
    public recoverable: boolean,
    public retryable: boolean,
    public metadata?: Record<string, unknown>
  ) {
    super(message);
    this.name = "MeshError";
  }
}
```

### 8.2 Recovery Strategies

```typescript
// recovery.ts

interface RecoveryStrategy {
  code: MeshErrorCode;
  strategy: "retry" | "failover" | "degrade" | "alert";
  action: (err: MeshError, ctx: PluginContext) => Promise<void>;
}

const recoveryStrategies: RecoveryStrategy[] = [
  {
    code: MeshErrorCode.PEER_UNREACHABLE,
    strategy: "failover",
    action: async (err, ctx) => {
      // Mark peer as offline, queue message
      const peerId = err.metadata?.peerId as string;
      await ctx.mesh.peers.markOffline(peerId);
      await ctx.mesh.queue.enqueue(err.metadata?.message);
    }
  },
  {
    code: MeshErrorCode.TIMEOUT,
    strategy: "retry",
    action: async (err, ctx) => {
      // Retry with exponential backoff
      const attempt = (err.metadata?.attempt ?? 0) + 1;
      if (attempt < 3) {
        await sleep(Math.pow(2, attempt) * 1000);
        await ctx.mesh.send(err.metadata?.peer, err.metadata?.message, { attempt });
      } else {
        throw new MeshError(
          MeshErrorCode.PEER_UNREACHABLE,
          "Max retries exceeded",
          false,
          false,
          err.metadata
        );
      }
    }
  },
  {
    code: MeshErrorCode.STORAGE_FULL,
    strategy: "degrade",
    action: async (err, ctx) => {
      // Switch to read-only mode, alert operator
      await ctx.mesh.memory.setReadOnly(true);
      await ctx.alerts.send("storage-full", { path: err.metadata?.path });
    }
  },
  {
    code: MeshErrorCode.SERVICE_DOWN,
    strategy: "alert",
    action: async (err, ctx) => {
      await ctx.alerts.send("service-down", { service: err.metadata?.service });
    }
  }
];

export async function handleError(err: MeshError, ctx: PluginContext): Promise<void> {
  const strategy = recoveryStrategies.find(s => s.code === err.code);
  
  if (strategy) {
    ctx.logger.info({ code: err.code, strategy: strategy.strategy }, "Applying recovery strategy");
    await strategy.action(err, ctx);
  } else {
    // No strategy: escalate
    throw err;
  }
}
```

---

## 9. Integration with systemd/launchd

### 9.1 Service Registration

While OpenClaw manages the plugin lifecycle, the underlying services (receiver, bridge) continue to run as systemd/launchd managed processes. OpenClaw acts as a supervisor.

```typescript
// systemd-integration.ts

export async function registerWithSystemd(
  serviceName: string,
  config: ServiceConfig
): Promise<ServiceHandle> {
  
  const unitName = `openclaw-mesh-${serviceName}`;
  
  // Check if systemd user session is available
  const systemdAvailable = await checkSystemdAvailable();
  
  if (!systemdAvailable) {
    // Fallback: spawn directly, log warning
    console.warn("systemd not available, spawning process directly");
    return spawnDirectly(serviceName, config);
  }
  
  // Generate systemd unit file if not exists
  const unitPath = `${process.env.HOME}/.config/systemd/user/${unitName}.service`;
  
  if (!await fileExists(unitPath)) {
    const unitContent = generateSystemdUnit(serviceName, config);
    await writeFile(unitPath, unitContent);
    await exec(`systemctl --user daemon-reload`);
  }
  
  // Enable and start service
  await exec(`systemctl --user enable ${unitName}`);
  await exec(`systemctl --user start ${unitName}`);
  
  return {
    name: serviceName,
    unitName,
    stop: async () => {
      await exec(`systemctl --user stop ${unitName}`);
    },
    restart: async () => {
      await exec(`systemctl --user restart ${unitName}`);
    },
    status: async () => {
      const result = await exec(`systemctl --user is-active ${unitName}`);
      return result.stdout.trim() === "active" ? "running" : "stopped";
    }
  };
}
```

### 9.2 Systemd Unit Template

```ini
# ~/.config/systemd/user/openclaw-mesh-receiver.service
[Unit]
Description=OpenClaw Mesh-Memory Receiver (managed by OpenClaw plugin)
PartOf=openclaw-gateway.service
After=openclaw-gateway.service network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/node %h/.openclaw/workspace/projects/mesh-memory/services/receiver.mjs
ExecStartPre=/bin/sleep 2
Restart=always
RestartSec=10
StartLimitInterval=60
StartLimitBurst=3

# Notify OpenClaw of state changes
ExecStartPost=/usr/bin/curl -sf http://localhost:18800/.mesh/notify?service=receiver&state=started
ExecStopPost=/usr/bin/curl -sf http://localhost:18800/.mesh/notify?service=receiver&state=stopped

# Resource limits
MemoryMax=512M
CPUQuota=50%

# Security
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=%h/.openclaw/workspace/memory

# Environment
Environment="NODE_ENV=production"
Environment="OPENCLAW_PLUGIN_MODE=true"
Environment="MESH_RECEIVER_PORT=18803"

[Install]
WantedBy=openclaw-gateway.service
```

---

## 10. Migration from Standalone to Plugin

### 10.1 Migration Path

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Migration Timeline (3 Phases)                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Phase 1: Dual Mode (Current)                                        │
│  ─────────────────────────                                           │
│  • Standalone mesh-memory continues to work                           │
│  • Plugin manifest added but not activated                          │
│  • Configuration in mesh-memory.config.local.json                     │
│                                                                      │
│  Phase 2: Hybrid Mode                                                │
│  ───────────────────                                                 │
│  • Plugin activated in openclaw.json                                  │
│  • Services run under systemd/launchd (managed by OpenClaw)           │
│  • Legacy config file read as fallback                                │
│  • Deprecation warnings logged                                        │
│                                                                      │
│  Phase 3: Plugin-Only (Target)                                       │
│  ────────────────────────────                                          │
│  • mesh-memory.config.local.json deprecated                          │
│  • All config in openclaw.json → plugins.mesh-memory                │
│  • Standalone startup script removed                                  │
│  • Full OpenClaw integration                                          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 10.2 Backwards Compatibility Layer

```typescript
// compat.ts

export async function loadConfig(ctx: PluginContext): Promise<MeshConfig> {
  const log = ctx.logger.child({ module: "config-loader" });
  
  // 1. Try OpenClaw plugin config first
  const pluginConfig = ctx.config.plugins?.["mesh-memory"];
  if (pluginConfig) {
    log.info("Using OpenClaw plugin configuration");
    return validateAndTransform(pluginConfig);
  }
  
  // 2. Fallback to legacy config file
  const legacyPath = path.join(
    process.env.HOME!,
    ".openclaw/workspace/projects/mesh-memory/mesh-memory.config.local.json"
  );
  
  if (await fileExists(legacyPath)) {
    log.warn("Using legacy mesh-memory.config.local.json — migrate to openclaw.json");
    const legacy = JSON.parse(await readFile(legacyPath, "utf-8"));
    return migrateLegacyConfig(legacy);
  }
  
  // 3. No config found
  throw new MeshError(
    MeshErrorCode.CONFIG_INVALID,
    "No mesh-memory configuration found",
    false,
    false
  );
}

function migrateLegacyConfig(legacy: LegacyConfig): MeshConfig {
  // Transform legacy format to new format
  return {
    agentId: legacy.agentId,
    receiver: {
      port: legacy.receiverPort ?? 18803,
      authToken: legacy.receiverToken
    },
    threadManager: {
      port: legacy.threadPort ?? 18802,
      enabled: true
    },
    peers: legacy.peers?.map(p => ({
      agentId: p.agentId,
      url: p.url,
      threadUrl: p.threadUrl,
      token: p.token
    })),
    storage: {
      backend: legacy.memory?.backend ?? "local",
      meshPath: "~/.openclaw/workspace/memory/mesh/",
      sharedPoolPath: "~/.openclaw/workspace/memory/shared/gates/"
    },
    features: {
      consensusProtocol: false,
      trustScoring: true,
      hotReload: true,
      vectorSearch: false
    }
  };
}
```

---

## 11. Implementation Checklist

### 11.1 Phase 1: Foundation

- [ ] Create `openclaw.plugin.json` manifest
- [ ] Implement plugin entry point (`index.ts`)
- [ ] Add lifecycle hooks (startup, shutdown)
- [ ] Create config schema validation
- [ ] Implement backwards compatibility layer

### 11.2 Phase 2: Core Features

- [ ] Implement event handlers (a2a, presence, system)
- [ ] Mount API routes under `/mesh/*`
- [ ] Add version compatibility checking
- [ ] Implement feature flag resolution
- [ ] Create health check integration

### 11.3 Phase 3: Integration

- [ ] Systemd/launchd service registration
- [ ] Config hot-reload support
- [ ] Error recovery strategies
- [ ] Graceful degradation paths
- [ ] Documentation and examples

### 11.4 Phase 4: Testing

- [ ] Unit tests for plugin lifecycle
- [ ] Integration tests with OpenClaw gateway
- [ ] Version compatibility matrix validation
- [ ] Degradation scenario testing
- [ ] Migration path testing

---

## 12. References

- `A2A_RECEIVER_SPEC.md` — Peer verification protocol
- `MESH_INFRASTRUCTURE_SPEC.md` — Service and port specifications
- `CUSTOM_MESH_PROTOCOL_PLAN_2026-04-12.md` — Protocol migration
- `DEPLOY.md` — Deployment procedures
- AGENTS.md — Standing rules (receivers as managed services)

---

*Document version: 1.0.0 — Generated by Liz Infrastructure Subagent*  
*RFC Status: Pending review by Ray and Woodhouse*  
*Next: ADR-0001 for plugin integration decision*
