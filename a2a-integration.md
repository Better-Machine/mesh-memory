# Mesh-Memory A2A Integration — Phase 1

## Goal
Make Palace/Kingdom discoverable via A2A v1.0 Agent Card specification.

## A2A Agent Card Structure (v1.0)

```json
{
  "name": "Liz",
  "description": "Head of Incubator & Development — multi-agent memory and deal negotiation",
  "url": "http://192.168.50.23:18810/a2a",
  "version": "1.0.0",
  "capabilities": {
    "a2aVersion": "1.0.0",
    "supportsStreaming": true,
    "supportsPushNotifications": false
  },
  "skills": [
    {
      "id": "palace-memory",
      "name": "Palace Memory (L0-L4)",
      "description": "Hierarchical agent memory: passport, critical facts, temporal knowledge graph",
      "tags": ["memory", "agent-identity", "knowledge-graph"],
      "examples": [
        "What do you know about project X?",
        "Store this as a critical fact"
      ]
    },
    {
      "id": "gatehouse-deals",
      "name": "Gatehouse Deal Negotiation",
      "description": "Multi-agent data escrow with human-in-the-loop approval",
      "tags": ["deals", "escrow", "negotiation", "security"],
      "examples": [
        "Propose sharing datasource with agent Y",
        "Approve pending deal"
      ]
    }
  ],
  "authentication": {
    "schemes": ["basic", "bearer"],
    "credentials": null
  },
  "defaultInputModes": ["text"],
  "defaultOutputModes": ["text", "data"]
}
```

## Implementation Plan

### Step 1: Agent Card Endpoint
Add to `palace-daemon.mjs`:
- `GET /.well-known/agent.json` — Returns Agent Card
- `GET /a2a/` — A2A protocol root

### Step 2: Passport Mapping
Map Palace L0 → A2A Agent Card:
- `passport.agentId` → `name`
- `passport.capabilities` → `skills[]`
- `passport.version` → `version`

### Step 3: Capability Advertisement
Expose mesh-memory capabilities:
- L1 Critical Facts (always-loaded context)
- L2 Deep Memory (searchable)
- L3 Temporal KG (time-travel, audit)
- L4 Kingdom (multi-agent coordination)
- Gatehouse (deals, escrow, negotiation)

### Step 4: Discovery Test
Test with external A2A client:
```bash
curl http://192.168.50.23:18810/.well-known/agent.json
```

### Step 5: Documentation
Update mesh-memory docs with A2A integration guide.

## Files to Modify
- `palace-daemon.mjs` — Add A2A endpoints
- `palace-mvp/agent-passport.json` — Add A2A metadata
- `palace-kingdom.mjs` — Add A2A skill registration

## Status
🔄 Phase 1 in progress
