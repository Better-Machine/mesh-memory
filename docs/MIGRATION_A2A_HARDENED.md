# Migration Guide: Raw A2A → Hardened A2A

**Version:** Phase 6  
**Date:** 2026-04-26

---

## Overview

This guide explains how to migrate from raw A2A Gateway calls to the hardened A2A integration layer.

---

## Before: Raw A2A

```javascript
// Direct A2A Gateway call - no guarantees
const result = await a2aClient.sendMessage(peer, message);
if (!result.ok) {
  // Message lost - no retry, no tracking
  console.error('Send failed:', result.error);
}
```

---

## After: Hardened A2A

### Basic Send (with delivery guarantee)

```javascript
import { initializeA2AIntegration, send } from './src/a2a-integration.mjs';

// Initialize once at startup
await initializeA2AIntegration({
  sendProvider: (peer, msg, opts) => a2aClient.sendMessage(peer, msg, opts)
});

// Send with full hardening
const result = await send('Ray', { text: 'Hello!' }, {
  guarantee: true,     // Enable delivery tracking
  context: true,       // Enable session continuity
  timeout: 30000
});

console.log('Delivery ID:', result.deliveryId);
console.log('Context ID:', result.contextId);
```

### With Context (Session Continuity)

```javascript
// First message - context auto-created
const result1 = await send('Ray', 'What were we discussing?', {
  context: true
});

// Later message - same context reused
const result2 = await send('Ray', 'About the deployment plan', {
  contextId: result1.contextId  // Reuse context
});

// Get conversation history
import { getThreadHistory } from './src/a2a-context-escrow.mjs';
const history = await getThreadHistory(result1.contextId, { limit: 20 });
```

### Check Delivery Status

```javascript
import { getDeliveryStatus } from './src/a2a-integration.mjs';

const status = await getDeliveryStatus(result.deliveryId);
console.log('Status:', status.status);  // pending | delivered | failed | dead_letter
```

### Discovery with Health Filtering

```javascript
import { discoverPeers } from './src/a2a-integration.mjs';

// Get healthy peers with specific capability
const peers = await discoverPeers({
  capability: 'mesh-memory',
  healthyOnly: true,
  limit: 10
});
```

### Retry Failed Messages

```javascript
import { retryFailed, getDeadLetterQueue } from './src/a2a-integration.mjs';

// Check failed messages
const failed = await getDeadLetterQueue();
console.log(`${failed.length} messages in DLQ`);

// Retry all failed messages
const retried = await retryFailed({ limit: 100 });
console.log(`Retried ${retried.length} messages`);
```

---

## Configuration

### Register Peers

```javascript
import { registerPeer } from './src/a2a-discovery-registry.mjs';

await registerPeer({
  name: 'Ray',
  agentCardUrl: 'http://192.168.50.22:18800/.well-known/agent.json',
  baseUrl: 'http://192.168.50.22:18800',
  auth: { type: 'bearer', token: 'your-token-here' },
  skills: ['mesh-memory', 'a2a-messaging'],
  versions: ['1.0', '2.0'],
  maxConcurrentTasks: 10
});
```

### Health Check Daemon

Add to crontab:

```bash
# Check A2A peer health every 60 seconds
* * * * * cd /home/erik-ross/.openclaw/workspace/projects/mesh-memory && node src/a2a-health-daemon.mjs &gt;&gt; logs/a2a-health.log 2&gt;&1
```

---

## Event Handling

```javascript
import { on } from './src/a2a-integration.mjs';

// Subscribe to delivery status changes
const unsubDelivery = on('deliveryStatus', (deliveryId, status, details) => {
  console.log(`Delivery ${deliveryId}: ${status}`);
});

// Subscribe to peer health changes
const unsubHealth = on('peerHealthChange', (peerName, health) => {
  console.log(`Peer ${peerName}: ${health.circuitBreakerState}`);
});

// Cleanup
unsubDelivery();
unsubHealth();
```

---

## Key Differences

| Feature | Raw A2A | Hardened A2A |
|---------|---------|--------------|
| Delivery Guarantee | ❌ Fire-and-forget | ✅ WAL queue + retry |
| Circuit Breaker | ❌ None | ✅ Auto-disable unhealthy peers |
| Session Context | ❌ Manual | ✅ Auto-briefing injection |
| Dead Letter | ❌ Lost | ✅ Queue + manual retry |
| Health Discovery | ❌ Static | ✅ Dynamic + metrics |
| Status Tracking | ❌ None | ✅ Queryable status API |

---

## Migration Checklist

- [ ] Import hardened A2A modules
- [ ] Initialize with `initializeA2AIntegration()`
- [ ] Register all peers via `registerPeer()`
- [ ] Replace `a2aClient.sendMessage()` with `send()`
- [ ] Add delivery status checks where needed
- [ ] Set up health check daemon cron
- [ ] Handle `deliveryStatus` events for monitoring
- [ ] Test circuit breaker with simulated failures
- [ ] Verify context continuity across messages
- [ ] Update error handling for dead letter queue

---

## Rollback Plan

If issues occur:

1. Stop health check daemon
2. Revert to raw A2A calls
3. Dead letter queue preserved in `memory/a2a-queue/dead-letter/`
4. Context history preserved in TKG

---

## Sample Usage for Ray/Woodhouse

```javascript
// ~/.openclaw/workspace/projects/mesh-memory/examples/hardened-a2a-example.mjs

import { 
  initializeA2AIntegration, 
  send, 
  discoverPeers,
  getDeliveryStatus,
  retryFailed,
  on 
} from '../src/a2a-integration.mjs';

import { A2AClient } from '~/.openclaw/extensions/a2a-gateway/src/client.ts';

const a2aClient = new A2AClient();

// Initialize
await initializeA2AIntegration({
  sendProvider: (peer, msg, opts) => a2aClient.sendMessage(peer, msg, opts)
});

// Subscribe to events
on('deliveryStatus', (id, status) => {
  console.log(`📨 ${id}: ${status}`);
});

on('peerHealthChange', (peer, health) => {
  console.log(`🔌 ${peer}: ${health.circuitBreakerState}`);
});

// Send to Ray
const result = await send('Ray', {
  kind: 'message',
  text: 'Hey Ray, how is the deployment going?'
}, { 
  guarantee: true, 
  context: true 
});

console.log('Sent:', result.deliveryId);

// Check status after delay
setTimeout(async () => {
  const status = await getDeliveryStatus(result.deliveryId);
  console.log('Status:', status);
}, 5000);
```

---

## Troubleshooting

### Circuit Breaker Opens Too Quickly

```javascript
// Check circuit state
import { getCircuitState } from './src/a2a-reliability-layer.mjs';
const state = getCircuitState('Ray');
console.log(state);  // { state, consecutiveFailures, lastFailureAt }
```

### Messages Stuck in Queue

```javascript
// Check pending
import { getPendingMessages, getQueueStats } from './src/a2a-reliability-layer.mjs';
const pending = await getPendingMessages(100);
const stats = await getQueueStats();
console.log('Pending:', stats.pending, 'Dead Letter:', stats.deadLetter);
```

### Context Not Found

```javascript
// List active contexts
import { listActiveContexts } from './src/a2a-context-escrow.mjs';
const contexts = await listActiveContexts({ peer: 'Ray' });
console.log('Active contexts:', contexts);
```
