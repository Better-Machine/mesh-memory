/**
 * @file a2a-integration.test.mjs
 * @description Test Suite for Hardened A2A Integration
 * 
 * Tests:
 * - Delivery guarantees (success, retry, dead letter)
 * - Circuit breaker (open, half-open, closed)
 * - Context escrow (create, reuse, expiry)
 * - Health registry (update, filter, degrade)
 * - Integration (end-to-end)
 */

import { strict as assert } from 'assert';
import { promises as fs } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

// Test configuration
const TEST_DIR = join(process.cwd(), 'tests', 'a2a-integration-temp');

// Test results
const results = {
  passed: 0,
  failed: 0,
  tests: []
};

/**
 * Test runner
 */
async function test(name, fn) {
  try {
    await fn();
    results.passed++;
    results.tests.push({ name, status: 'PASS' });
    console.log(`✓ ${name}`);
  } catch (err) {
    results.failed++;
    results.tests.push({ name, status: 'FAIL', error: err.message });
    console.log(`✗ ${name}: ${err.message}`);
  }
}

/**
 * Setup test environment
 */
async function setup() {
  // Create test directory
  await fs.mkdir(TEST_DIR, { recursive: true });
  
  // Mock config
  global.mockConfig = {
    memory: { baseDir: TEST_DIR }
  };
}

/**
 * Cleanup test environment
 */
async function cleanup() {
  try {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// ============================================================================
// RELIABILITY LAYER TESTS
// ============================================================================

async function runReliabilityTests() {
  console.log('\n📦 Reliability Layer Tests\n');
  
  const { 
    initializeReliabilityLayer,
    sendWithGuarantee,
    getDeliveryStatus,
    acknowledgeDelivery,
    markDelivered,
    recordAttemptFailure,
    retryFailed,
    getDeadLetterQueue,
    getQueueStats,
    closeReliabilityLayer
  } = await import('../src/a2a-reliability-layer.mjs');
  
  // Import DeliveryStatus from circuit-breaker.mjs (re-exported for convenience)
  const { DeliveryStatus } = await import('../src/circuit-breaker.mjs');
  
  // Override config
  const originalLoadConfig = await import('../config.mjs');
  const configPath = join(TEST_DIR, 'a2a-queue');
  await fs.mkdir(configPath, { recursive: true });
  
  // Initialize
  await initializeReliabilityLayer();
  
  await test('Should queue message with delivery guarantee', async () => {
    const deliveryId = await sendWithGuarantee('test-peer', { text: 'hello' });
    assert.ok(deliveryId.startsWith('dlv_'), 'Should have valid delivery ID');
    
    const status = await getDeliveryStatus(deliveryId);
    assert.equal(status.status, DeliveryStatus.PENDING);
  });
  
  await test('Should acknowledge delivery', async () => {
    const deliveryId = await sendWithGuarantee('test-peer', { text: 'test' });
    const ack = await acknowledgeDelivery(deliveryId);
    assert.ok(ack, 'Should acknowledge successfully');
    
    const status = await getDeliveryStatus(deliveryId);
    assert.equal(status.status, DeliveryStatus.DELIVERED);
  });
  
  await test('Should mark delivery as sent', async () => {
    const deliveryId = await sendWithGuarantee('test-peer', { text: 'mark test' });
    await markDelivered(deliveryId);
    
    const status = await getDeliveryStatus(deliveryId);
    assert.equal(status.status, DeliveryStatus.DELIVERED);
    assert.ok(status.deliveredAt, 'Should have delivered timestamp');
  });
  
  await test('Should track failed attempts', async () => {
    const deliveryId = await sendWithGuarantee('test-peer', { text: 'fail test' });
    
    // Simulate failures
    for (let i = 0; i < 4; i++) {
      const result = await recordAttemptFailure(deliveryId, 'Network error');
      assert.ok(result.shouldRetry, `Attempt ${i + 1} should allow retry`);
      assert.equal(result.attempts, i + 1);
    }
    
    // 5th failure should move to dead letter
    const result = await recordAttemptFailure(deliveryId, 'Network error');
    assert.ok(result.deadLetter, 'Should move to dead letter');
    
    const dlq = await getDeadLetterQueue();
    assert.ok(dlq.length > 0, 'Should have dead letter entries');
  });
  
  await test('Should retry from dead letter queue', async () => {
    const deliveryId = await sendWithGuarantee('test-peer', { text: 'retry test' });
    await recordAttemptFailure(deliveryId, 'Error');
    await recordAttemptFailure(deliveryId, 'Error');
    await recordAttemptFailure(deliveryId, 'Error');
    await recordAttemptFailure(deliveryId, 'Error');
    await recordAttemptFailure(deliveryId, 'Error'); // Move to DLQ
    
    const retried = await retryFailed({ limit: 10 });
    assert.ok(retried.includes(deliveryId), 'Should retry the delivery');
    
    const status = await getDeliveryStatus(deliveryId);
    assert.equal(status.status, DeliveryStatus.PENDING);
  });
  
  await test('Should calculate queue statistics', async () => {
    const stats = await getQueueStats();
    assert.ok(typeof stats.total === 'number');
    assert.ok(typeof stats.pending === 'number');
    assert.ok(typeof stats.delivered === 'number');
    assert.ok(typeof stats.deadLetter === 'number');
  });
  
  await closeReliabilityLayer();
}

// ============================================================================
// CIRCUIT BREAKER TESTS
// ============================================================================

async function runCircuitBreakerTests() {
  console.log('\n🔌 Circuit Breaker Tests\n');
  
  const { 
    initializeReliabilityLayer,
    isCircuitClosed,
    recordSuccess,
    recordFailure,
    getCircuitState,
    CircuitState,
    closeReliabilityLayer
  } = await import('../src/a2a-reliability-layer.mjs');
  
  await initializeReliabilityLayer();
  
  await test('Should start with closed circuit', async () => {
    const state = getCircuitState('test-peer-cb');
    assert.equal(state.state, CircuitState.CLOSED);
    assert.ok(isCircuitClosed('test-peer-cb'), 'Should allow requests');
  });
  
  await test('Should open circuit after 5 failures', async () => {
    // Record 5 failures
    for (let i = 0; i < 5; i++) {
      await recordFailure('test-peer-cb', 'Error');
    }
    
    const state = getCircuitState('test-peer-cb');
    assert.equal(state.state, CircuitState.OPEN);
    assert.ok(!isCircuitClosed('test-peer-cb'), 'Should block requests');
  });
  
  await test('Should close circuit on success', async () => {
    // Reset first
    await recordSuccess('test-peer-cb');
    
    const state = getCircuitState('test-peer-cb');
    assert.equal(state.state, CircuitState.CLOSED);
    assert.ok(isCircuitClosed('test-peer-cb'), 'Should allow requests');
  });
  
  await test('Should track consecutive failures', async () => {
    await recordSuccess('test-peer-cb2');
    
    await recordFailure('test-peer-cb2', 'Error 1');
    let state = getCircuitState('test-peer-cb2');
    assert.equal(state.consecutiveFailures, 1);
    
    await recordFailure('test-peer-cb2', 'Error 2');
    state = getCircuitState('test-peer-cb2');
    assert.equal(state.consecutiveFailures, 2);
    
    // Success should reset
    await recordSuccess('test-peer-cb2');
    state = getCircuitState('test-peer-cb2');
    assert.equal(state.consecutiveFailures, 0);
  });
  
  await closeReliabilityLayer();
}

// ============================================================================
// CONTEXT ESCROW TESTS
// ============================================================================

async function runContextEscrowTests() {
  console.log('\n📁 Context Escrow Tests\n');
  
  const { 
    initializeContextEscrow,
    getOrCreateContext,
    storeMessage,
    getThreadHistory,
    closeContext,
    generateContextId,
    closeContextEscrow
  } = await import('../src/a2a-context-escrow.mjs');
  
  await initializeContextEscrow();
  
  await test('Should generate valid context ID', async () => {
    const ctxId = generateContextId();
    assert.ok(ctxId.startsWith('ctx_'), 'Should have ctx_ prefix');
    assert.equal(ctxId.length, 20, 'Should be correct length');
  });
  
  await test('Should create new context', async () => {
    const ctxId = generateContextId();
    const context = await getOrCreateContext(ctxId, { 
      peerName: 'test-peer',
      purpose: 'Test session'
    });
    
    assert.equal(context.contextId, ctxId);
    assert.ok(context.roomId.startsWith('dr_'), 'Should have room ID');
    assert.equal(context.peerName, 'test-peer');
    assert.ok(context.isNew, 'Should be new context');
  });
  
  await test('Should reuse existing context', async () => {
    const ctxId = generateContextId();
    await getOrCreateContext(ctxId, { peerName: 'test-peer' });
    
    // Get same context
    const context = await getOrCreateContext(ctxId, { peerName: 'test-peer' });
    assert.ok(!context.isNew, 'Should not be new');
  });
  
  await test('Should store and retrieve messages', async () => {
    const ctxId = generateContextId();
    await getOrCreateContext(ctxId, { peerName: 'test-peer' });
    
    await storeMessage(ctxId, 'outbound', 'self', 'Hello');
    await storeMessage(ctxId, 'inbound', 'test-peer', 'Hi there');
    await storeMessage(ctxId, 'outbound', 'self', 'How are you?');
    
    const history = await getThreadHistory(ctxId);
    assert.equal(history.length, 3, 'Should have 3 messages');
    assert.equal(history[0].direction, 'outbound');
    assert.equal(history[1].direction, 'inbound');
  });
  
  await test('Should close context', async () => {
    const ctxId = generateContextId();
    await getOrCreateContext(ctxId, { peerName: 'test-peer' });
    
    const closed = await closeContext(ctxId, 'test closure');
    assert.ok(closed, 'Should close successfully');
  });
  
  await closeContextEscrow();
}

// ============================================================================
// DISCOVERY REGISTRY TESTS
// ============================================================================

async function runDiscoveryRegistryTests() {
  console.log('\n🔍 Discovery Registry Tests\n');
  
  const { 
    initializeDiscoveryRegistry,
    registerPeer,
    getHealthyPeer,
    updatePeerHealth,
    listAvailablePeers,
    getPeer,
    unregisterPeer,
    closeDiscoveryRegistry
  } = await import('../src/a2a-discovery-registry.mjs');
  
  await initializeDiscoveryRegistry();
  
  await test('Should register a new peer', async () => {
    const peer = await registerPeer({
      name: 'test-peer-1',
      agentCardUrl: 'http://localhost:8080/.well-known/agent.json',
      baseUrl: 'http://localhost:8080',
      auth: { type: 'bearer', token: 'test-token' },
      skills: ['messaging', 'tasks'],
      versions: ['1.0', '2.0'],
      maxConcurrentTasks: 5
    });
    
    assert.equal(peer.name, 'test-peer-1');
    assert.deepEqual(peer.skills, ['messaging', 'tasks']);
    assert.equal(peer.health.circuitBreakerState, 'closed');
  });
  
  await test('Should reject invalid peer config', async () => {
    try {
      await registerPeer({ name: 'bad-peer' }); // Missing agentCardUrl
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('agentCardUrl'));
    }
  });
  
  await test('Should retrieve registered peer', async () => {
    const peer = await getPeer('test-peer-1');
    assert.ok(peer);
    assert.equal(peer.name, 'test-peer-1');
  });
  
  await test('Should return null for unknown peer', async () => {
    const peer = await getPeer('unknown-peer');
    assert.equal(peer, null);
  });
  
  await test('Should update peer health', async () => {
    // Register fresh peer for this test
    await registerPeer({
      name: 'test-peer-health-1',
      agentCardUrl: 'http://localhost:8085/.well-known/agent.json'
    });
    
    await updatePeerHealth('test-peer-health-1', { success: true, latencyMs: 100 });
    
    const peer = await getPeer('test-peer-health-1');
    assert.equal(peer.health.successRate, 1.0);
    assert.equal(peer.health.totalRequests, 1);
  });
  
  await test('Should track failed requests', async () => {
    // Register fresh peer for this test
    await registerPeer({
      name: 'test-peer-health-2',
      agentCardUrl: 'http://localhost:8086/.well-known/agent.json'
    });
    
    await updatePeerHealth('test-peer-health-2', { success: false, latencyMs: 5000, errorCode: 'TIMEOUT' });
    
    const peer = await getPeer('test-peer-health-2');
    assert.equal(peer.health.failedRequests, 1);
    assert.equal(peer.health.successRate, 0);
    assert.equal(peer.health.totalRequests, 1);
  });
  
  await test('Should filter by capability', async () => {
    await registerPeer({
      name: 'capability-peer',
      agentCardUrl: 'http://localhost:8082/.well-known/agent.json',
      skills: ['special-skill']
    });
    
    // Add health data to make it appear healthy
    await updatePeerHealth('capability-peer', { success: true, latencyMs: 50 });
    
    const peers = await listAvailablePeers({ 
      capability: 'special-skill',
      healthyOnly: false 
    });
    
    const found = peers.find(p => p.name === 'capability-peer');
    assert.ok(found, 'Should find peer with capability');
  });
  
  await test('Should unregister peer', async () => {
    const removed = await unregisterPeer('test-peer-2');
    assert.ok(removed, 'Should unregister successfully');
    
    const peer = await getPeer('test-peer-2');
    assert.equal(peer, null);
  });
  
  await closeDiscoveryRegistry();
}

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

async function runIntegrationTests() {
  console.log('\n🔗 Integration Tests\n');
  
  const { 
    initializeA2AIntegration,
    send,
    discoverPeers,
    getDeliveryStatus,
    getStats,
    closeA2AIntegration
  } = await import('../src/a2a-integration.mjs');
  
  // Mock send provider
  const mockSendProvider = async (peer, message, options) => {
    return { success: true, messageId: 'mock-msg-id' };
  };
  
  await initializeA2AIntegration({ sendProvider: mockSendProvider });
  
  await test('Should initialize integration', async () => {
    const stats = await getStats();
    assert.ok(stats.queue);
    assert.ok(stats.escrow);
    assert.ok(stats.registry);
  });
  
  await test('Should register and discover peers', async () => {
    const { registerPeer } = await import('../src/a2a-discovery-registry.mjs');
    
    await registerPeer({
      name: 'integration-peer',
      agentCardUrl: 'http://localhost:9000/.well-known/agent.json',
      skills: ['integration-test']
    });
    
    // Note: peer won't appear as healthy without health data
    const peers = await discoverPeers({ capability: 'integration-test', healthyOnly: false });
    assert.ok(peers.length >= 1);
  });
  
  await closeA2AIntegration();
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   Phase 6: Hardened A2A Integration Test Suite           ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  
  const startTime = Date.now();
  
  try {
    await setup();
    
    await runReliabilityTests();
    await runCircuitBreakerTests();
    await runContextEscrowTests();
    await runDiscoveryRegistryTests();
    await runIntegrationTests();
    
  } finally {
    await cleanup();
  }
  
  const duration = Date.now() - startTime;
  
  // Summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Total:  ${results.passed + results.failed}`);
  console.log(`Passed: ${results.passed} ✓`);
  console.log(`Failed: ${results.failed} ✗`);
  console.log(`Duration: ${duration}ms`);
  console.log('═══════════════════════════════════════════════════════════\n');
  
  // Write report
  const reportPath = join(process.cwd(), 'tests', 'A2A_INTEGRATION_TEST_REPORT.md');
  const report = `# A2A Integration Test Report

**Date:** ${new Date().toISOString()}
**Duration:** ${duration}ms

## Results

| Metric | Value |
|--------|-------|
| Total | ${results.passed + results.failed} |
| Passed | ${results.passed} |
| Failed | ${results.failed} |

## Test Cases

| Test | Status |
|------|--------|
${results.tests.map(t => `| ${t.name} | ${t.status} |`).join('\n')}

${results.failed > 0 ? `## Failures

${results.tests.filter(t => t.status === 'FAIL').map(t => `### ${t.name}
- ${t.error}`).join('\n\n')}
` : ''}

## Conclusion

${results.failed === 0 ? '✅ All tests passed. Ready for PR.' : `⚠️ ${results.failed} test(s) failed. Please review.`}
`;
  
  await fs.writeFile(reportPath, report);
  console.log(`Report written to: ${reportPath}`);
  
  process.exit(results.failed > 0 ? 1 : 0);
}

// Run tests
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
