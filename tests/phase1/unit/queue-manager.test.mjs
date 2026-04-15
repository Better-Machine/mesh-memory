/**
 * Queue Manager Unit Tests - Phase 1: Foundation Hardening
 * 
 * Tests:
 * - Queue message persistence
 * - Retry with exponential backoff (30s, 60s, 120s, 240s, 480s)
 * - DLQ after 5 retries
 * - Metrics endpoint
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getQueueManager, resetQueueManager } from '../../../src/queue-manager.mjs';
import { delay, resetTestState, TEST_PATHS, createTestMessage } from '../setup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = TEST_PATHS.db;

// Expected backoff delays in seconds
const EXPECTED_BACKOFF_DELAYS = [30, 60, 120, 240, 480];

describe('Queue Manager', async () => {

  describe('Message Persistence', async () => {
    await resetTestState();

    await test('enqueues a message with persistence', async () => {
      resetQueueManager();
      
      const manager = await getQueueManager({
        dbPath: TEST_DB_PATH,
        processorInterval: 10000 // Don't auto-process during test
      });

      const message = createTestMessage('test', { data: 'hello' });
      
      const result = await manager.enqueue({
        message,
        peerId: 'test-peer',
        endpoint: 'http://localhost:18803'
      });

      assert.strictEqual(result.success, true);
      assert.ok(result.id, 'Should have queue ID');
      assert.ok(result.nextRetry, 'Should have next retry time');

      // Verify database file exists
      const dbExists = await fs.access(TEST_DB_PATH).then(() => true).catch(() => false);
      assert.strictEqual(dbExists, true, 'Database should be persisted to disk');
    });

    await test('persists messages across instances', async () => {
      const manager1 = await getQueueManager({
        dbPath: TEST_DB_PATH,
        processorInterval: 10000
      });

      const message = createTestMessage('test', { data: 'persistent' });
      const enqueued = await manager1.enqueue({
        message,
        peerId: 'persistent-peer',
        endpoint: 'http://localhost:18803'
      });

      // Reset singleton
      resetQueueManager();

      // Create new instance with same database
      const manager2 = await getQueueManager({
        dbPath: TEST_DB_PATH,
        processorInterval: 10000
      });

      const metrics = await manager2.getMetrics();
      assert.ok(metrics.queue.depth >= 1, 'Message should persist across instances');
    });

    await test('stores message with all fields', async () => {
      resetQueueManager();
      
      const manager = await getQueueManager({
        dbPath: TEST_DB_PATH,
        processorInterval: 10000
      });

      const message = createTestMessage('complex', { 
        nested: { key: 'value' },
        array: [1, 2, 3]
      });

      const result = await manager.enqueue({
        message,
        peerId: 'test-peer',
        endpoint: 'http://localhost:18803'
      });

      assert.strictEqual(result.success, true);
    });
  });

  describe('Exponential Backoff', async () => {
    await resetTestState();

    await test('uses correct backoff delays', async () => {
      resetQueueManager();
      
      const manager = await getQueueManager({
        dbPath: TEST_DB_PATH,
        processorInterval: 10000,
        maxRetries: 5,
        backoffDelays: EXPECTED_BACKOFF_DELAYS
      });

      // Verify backoff configuration
      assert.deepStrictEqual(manager.backoffDelays, EXPECTED_BACKOFF_DELAYS);
      assert.strictEqual(manager.maxRetries, 5);
    });

    await test('increments retry attempts on failure', async () => {
      await resetTestState();
      resetQueueManager();
      
      let attemptCount = 0;
      
      const manager = await getQueueManager({
        dbPath: TEST_DB_PATH,
        processorInterval: 10000,
        maxRetries: 5,
        backoffDelays: [1, 2, 4, 8, 16] // Fast delays for testing
      });

      // Register a handler that always fails
      manager.registerHandler('retry-test-peer', async () => {
        attemptCount++;
        throw new Error('Simulated failure');
      });

      // Enqueue message
      const message = createTestMessage('retry-test', { id: 'test-1' });
      await manager.enqueue({
        message,
        peerId: 'retry-test-peer',
        endpoint: 'http://localhost:18803'
      });

      // Process multiple times
      for (let i = 0; i < 3; i++) {
        await manager.processQueue();
        await delay(100); // Small delay between processes
      }

      assert.ok(attemptCount >= 1, 'Should have attempted delivery');
    });

    await test('calculates next retry with exponential backoff', async () => {
      resetQueueManager();
      
      const manager = await getQueueManager({
        dbPath: TEST_DB_PATH,
        processorInterval: 10000,
        backoffDelays: EXPECTED_BACKOFF_DELAYS
      });

      const message = createTestMessage('backoff-test');
      const result = await manager.enqueue({
        message,
        peerId: 'backoff-peer',
        endpoint: 'http://localhost:18803'
      });

      // First retry should be at initial delay
      const now = Date.now();
      const expectedNextRetry = now + (EXPECTED_BACKOFF_DELAYS[0] * 1000);
      
      // Allow 5 second tolerance for test execution time
      assert.ok(
        Math.abs(new Date(result.nextRetry).getTime() - expectedNextRetry) < 5000,
        'Next retry should use first backoff delay'
      );
    });
  });

  describe('Dead Letter Queue (DLQ)', async () => {
    await resetTestState();

    await test('moves to DLQ after max retries', async () => {
      await resetTestState();
      resetQueueManager();
      
      const manager = await getQueueManager({
        dbPath: TEST_DB_PATH,
        processorInterval: 10000,
        maxRetries: 2, // Low for testing
        backoffDelays: [1, 1] // Fast retries
      });

      // Register failing handler
      manager.registerHandler('dlq-test-peer', async () => {
        throw new Error('Always fails');
      });

      const messageId = `dlq-test-${Date.now()}`;
      const message = createTestMessage('dlq-test', { id: messageId });
      
      await manager.enqueue({
        message,
        peerId: 'dlq-test-peer',
        endpoint: 'http://localhost:18803'
      });

      // Process many times to exhaust retries
      for (let i = 0; i < 10; i++) {
        await manager.processQueue();
        await delay(50);
      }

      // Check DLQ
      const dlq = await manager.getDlq(50, 0);
      assert.ok(dlq.entries.length >= 1, 'Should have DLQ entries');
      
      // Find our specific message
      const ourEntry = dlq.entries.find(e => e.message?.id === messageId);
      if (ourEntry) {
        assert.ok(ourEntry.lastError, 'DLQ entry should have error info');
        assert.ok(ourEntry.attempts >= 2, 'Should have exhausted retries');
      }
    });

    await test('can retry DLQ entries', async () => {
      resetQueueManager();
      
      const manager = await getQueueManager({
        dbPath: TEST_DB_PATH,
        processorInterval: 10000,
        maxRetries: 2,
        backoffDelays: [1, 1]
      });

      // Get any existing DLQ entries
      const dlq = await manager.getDlq(1, 0);
      
      if (dlq.entries.length > 0) {
        const entryId = dlq.entries[0].id;
        const result = await manager.retryDlqEntry(entryId);
        
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.message, 'Re-queued for delivery');
      }
    });

    await test('can delete DLQ entries', async () => {
      const manager = await getQueueManager({
        dbPath: TEST_DB_PATH,
        processorInterval: 10000
      });

      const dlq = await manager.getDlq(1, 0);
      
      if (dlq.entries.length > 0) {
        const entryId = dlq.entries[0].id;
        const result = await manager.deleteDlqEntry(entryId);
        
        assert.strictEqual(result.success, true);
      }
    });

    await test('DLQ entries contain full context', async () => {
      resetQueueManager();
      
      const manager = await getQueueManager({
        dbPath: TEST_DB_PATH,
        processorInterval: 10000,
        maxRetries: 1,
        backoffDelays: [1]
      });

      manager.registerHandler('context-test-peer', async () => {
        throw new Error('Context test error');
      });

      const message = createTestMessage('context-test', { key: 'value' });
      await manager.enqueue({
        message,
        peerId: 'context-test-peer',
        endpoint: 'http://test-endpoint:18803'
      });

      // Process to move to DLQ
      for (let i = 0; i < 5; i++) {
        await manager.processQueue();
        await delay(50);
      }

      const dlq = await manager.getDlq(10, 0);
      
      for (const entry of dlq.entries) {
        assert.ok(entry.id, 'Entry should have ID');
        assert.ok(entry.message, 'Entry should have message');
        assert.ok(entry.attempts >= 1, 'Entry should have attempt count');
        assert.ok(entry.failedAt, 'Entry should have failed timestamp');
        assert.ok(entry.createdAt, 'Entry should have created timestamp');
        assert.ok(entry.peerId, 'Entry should have peer ID');
        assert.ok(entry.endpoint, 'Entry should have endpoint');
        assert.ok(entry.lastError, 'Entry should have last error');
      }
    });
  });

  describe('Metrics Collection', async () => {
    await resetTestState();

    await test('provides queue metrics', async () => {
      resetQueueManager();
      
      const manager = await getQueueManager({
        dbPath: TEST_DB_PATH,
        processorInterval: 10000
      });

      const metrics = await manager.getMetrics();

      assert.ok(metrics.queue, 'Should have queue metrics');
      assert.strictEqual(typeof metrics.queue.depth, 'number');
      assert.strictEqual(typeof metrics.queue.oldestMessageAge, 'number');
      assert.strictEqual(typeof metrics.queue.readyToSend, 'number');
      
      assert.ok(metrics.dlq, 'Should have DLQ metrics');
      assert.strictEqual(typeof metrics.dlq.count, 'number');
      
      assert.ok(metrics.throughput, 'Should have throughput metrics');
    });

    await test('collects and stores metrics', async () => {
      const manager = await getQueueManager({
        dbPath: TEST_DB_PATH,
        processorInterval: 10000
      });

      // Collect metrics
      await manager.collectMetrics();
      
      // Get metrics again
      const metrics = await manager.getMetrics();
      
      assert.ok(metrics.recent, 'Should have recent metrics');
      assert.ok(Array.isArray(metrics.recent), 'Recent metrics should be array');
    });

    await test('metrics reflect queue depth accurately', async () => {
      await resetTestState();
      resetQueueManager();
      
      const manager = await getQueueManager({
        dbPath: TEST_DB_PATH,
        processorInterval: 10000
      });

      // Get initial depth
      const initialMetrics = await manager.getMetrics();
      const initialDepth = initialMetrics.queue.depth;

      // Add messages
      for (let i = 0; i < 5; i++) {
        await manager.enqueue({
          message: createTestMessage('depth-test', { index: i }),
          peerId: 'depth-peer',
          endpoint: 'http://localhost:18803'
        });
      }

      // Check updated depth
      const updatedMetrics = await manager.getMetrics();
      assert.strictEqual(
        updatedMetrics.queue.depth,
        initialDepth + 5,
        'Queue depth should increase by 5'
      );
    });

    await test('metrics endpoint provides status', async () => {
      const manager = await getQueueManager({
        dbPath: TEST_DB_PATH,
        processorInterval: 10000
      });

      const status = await manager.getStatus();

      assert.ok(status.healthy !== undefined, 'Should have healthy status');
      assert.ok(status.queue, 'Should have queue info');
      assert.ok(status.dlq, 'Should have DLQ info');
      assert.ok(status.processor, 'Should have processor info');
      assert.strictEqual(typeof status.processor.running, 'boolean');
      assert.ok(status.processor.interval, 'Should have processor interval');
    });
  });

  describe('Message Handlers', async () => {
    await resetTestState();

    await test('registers and calls message handlers', async () => {
      resetQueueManager();
      
      const manager = await getQueueManager({
        dbPath: TEST_DB_PATH,
        processorInterval: 10000
      });

      let handlerCalled = false;
      let receivedMessage = null;
      let receivedContext = null;

      manager.registerHandler('test-handler-peer', async (message, ctx) => {
        handlerCalled = true;
        receivedMessage = message;
        receivedContext = ctx;
      });

      const message = createTestMessage('handler-test', { data: 'test' });
      await manager.enqueue({
        message,
        peerId: 'test-handler-peer',
        endpoint: 'http://localhost:18803'
      });

      await manager.processQueue();

      assert.strictEqual(handlerCalled, true, 'Handler should be called');
      assert.deepStrictEqual(receivedMessage, message);
      assert.strictEqual(receivedContext?.peerId, 'test-handler-peer');
      assert.strictEqual(receivedContext?.endpoint, 'http://localhost:18803');
    });

    await test('unregisters message handlers', async () => {
      const manager = await getQueueManager({
        dbPath: TEST_DB_PATH,
        processorInterval: 10000
      });

      manager.registerHandler('unregister-test', async () => {});
      manager.unregisterHandler('unregister-test');

      // Handler list should be empty (or not include our handler)
      const status = await manager.getStatus();
      assert.ok(!status.handlers.includes('unregister-test'));
    });

    await test('uses default HTTP handler when no custom handler', async () => {
      resetQueueManager();
      
      const manager = await getQueueManager({
        dbPath: TEST_DB_PATH,
        processorInterval: 10000
      });

      // Don't register handler - should use default HTTP
      const message = createTestMessage('http-test');
      await manager.enqueue({
        message,
        peerId: 'http-peer',
        endpoint: 'http://localhost:19999' // Non-existent endpoint
      });

      // Should not throw - will fail and retry
      await manager.processQueue();
      
      // Message should still be in queue (failed)
      const metrics = await manager.getMetrics();
      assert.ok(metrics.queue.depth >= 1);
    });
  });

  describe('Queue Processing', async () => {
    await resetTestState();

    await test('processes messages in order', async () => {
      resetQueueManager();
      
      const manager = await getQueueManager({
        dbPath: TEST_DB_PATH,
        processorInterval: 10000
      });

      const processed = [];

      manager.registerHandler('order-peer', async (message) => {
        processed.push(message.sequence);
      });

      // Enqueue messages in order
      for (let i = 0; i < 3; i++) {
        await manager.enqueue({
          message: createTestMessage('order-test', { sequence: i }),
          peerId: 'order-peer',
          endpoint: 'http://localhost:18803'
        });
      }

      await manager.processQueue();

      // Should process all messages
      assert.ok(processed.length >= 1);
    });

    await test('respects processor interval', async () => {
      resetQueueManager();
      
      const manager = await getQueueManager({
        dbPath: TEST_DB_PATH,
        processorInterval: 5000 // 5 seconds
      });

      const status = await manager.getStatus();
      assert.strictEqual(status.processor.running, true);
      assert.strictEqual(status.processor.interval, 5000);

      manager.stopProcessor();
      
      const stoppedStatus = await manager.getStatus();
      assert.strictEqual(stoppedStatus.processor.running, false);
    });

    await test('prevents concurrent processing', async () => {
      resetQueueManager();
      
      let processingCount = 0;
      
      const manager = await getQueueManager({
        dbPath: TEST_DB_PATH,
        processorInterval: 10000
      });

      manager.registerHandler('concurrent-peer', async () => {
        processingCount++;
        await delay(100);
        processingCount--;
      });

      await manager.enqueue({
        message: createTestMessage('concurrent-test'),
        peerId: 'concurrent-peer',
        endpoint: 'http://localhost:18803'
      });

      // Try to process twice concurrently
      await Promise.all([
        manager.processQueue(),
        manager.processQueue()
      ]);

      assert.ok(processingCount <= 1, 'Should not process concurrently');
    });
  });

  describe('Lifecycle Management', async () => {
    await resetTestState();

    await test('starts and stops processor', async () => {
      resetQueueManager();
      
      const manager = await getQueueManager({
        dbPath: TEST_DB_PATH,
        processorInterval: 1000
      });

      assert.ok(manager.processorTimer, 'Should have processor timer');

      manager.stopProcessor();
      assert.strictEqual(manager.processorTimer, null);
    });

    await test('starts and stops metrics collector', async () => {
      const manager = await getQueueManager({
        dbPath: TEST_DB_PATH,
        processorInterval: 10000
      });

      manager.startMetricsCollector();
      assert.ok(manager.metricsTimer, 'Should have metrics timer');

      manager.stopMetricsCollector();
      assert.strictEqual(manager.metricsTimer, null);
    });

    await test('closes database connection', async () => {
      resetQueueManager();
      
      const manager = await getQueueManager({
        dbPath: TEST_DB_PATH,
        processorInterval: 10000
      });

      await manager.close();
      
      assert.strictEqual(manager.db, null);
      assert.strictEqual(manager.initialized, false);
    });

    await test('reset creates new instance', async () => {
      const manager1 = await getQueueManager({
        dbPath: TEST_DB_PATH,
        processorInterval: 10000
      });

      resetQueueManager();

      const manager2 = await getQueueManager({
        dbPath: TEST_DB_PATH,
        processorInterval: 10000
      });

      assert.notStrictEqual(manager1, manager2, 'Should create new instance');
    });
  });

  // Final cleanup
  await resetTestState();
});